// ── Hevy public API client (server-side only) ───────────
//
// The only module in Vital that knows Hevy's wire protocol
// (https://api.hevyapp.com/docs/). It reads HEVY_API_KEY from the server
// environment, sends it as the `api-key` header, and never puts it in a return
// value, an error message or a log.
//
// Endpoints used:
//   GET /v1/user/info                                   probe
//   GET /v1/workouts?page=&pageSize=  (≤10, newest first) → { page, page_count, workouts }
//   GET /v1/workouts/events?since=&page=&pageSize=      → { page, page_count, events }
//   GET /v1/exercise_templates?page=&pageSize= (≤100)   → { page, page_count, exercise_templates }
//
// A rate-limited answer (429) is retried a bounded number of times; every other
// failure is reported with a typed kind so the status panel can say what broke.

import { safeExcerpt } from '../../analyst/scrub';
import type { SourceRequestDeps } from '../types';

export const HEVY_DEFAULT_URL = 'https://api.hevyapp.com';
export const HEVY_WORKOUT_PAGE_SIZE = 10;
export const HEVY_TEMPLATE_PAGE_SIZE = 100;
/** Hard ceiling on pages read in one sync, so a misbehaving API cannot loop forever. */
export const HEVY_MAX_PAGES = 400;
export const HEVY_RATE_LIMIT_RETRIES = 3;
export const HEVY_RATE_LIMIT_BACKOFF_MS = 1500;
export const HEVY_TIMEOUT_MS = 15_000;

export type HevyFailureKind =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_payload';

export class HevyError extends Error {
  constructor(
    message: string,
    readonly kind: HevyFailureKind,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'HevyError';
  }
}

export interface HevyConfig {
  baseUrl: string;
  apiKey: string;
  ttlSeconds: number;
  timeoutMs: number;
}

/** Read the configuration. Returns null when no key is set. */
export function readHevyConfig(env: NodeJS.ProcessEnv = process.env): HevyConfig | null {
  const key = (env.HEVY_API_KEY ?? '').trim();
  if (!key) return null;
  const url = (env.HEVY_API_URL ?? '').trim().replace(/\/+$/, '') || HEVY_DEFAULT_URL;
  const ttl = Number(env.HEVY_CACHE_TTL_SECONDS);
  return {
    baseUrl: url,
    apiKey: key,
    ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 300,
    timeoutMs: HEVY_TIMEOUT_MS,
  };
}

export function hevyHost(config: HevyConfig): string | null {
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** GET one JSON object from the API, with a timeout and bounded 429 retries. */
export async function hevyGet<T>(
  config: HevyConfig,
  pathAndQuery: string,
  deps: SourceRequestDeps = {}
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const path = pathAndQuery.split('?')[0];

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${pathAndQuery}`, {
        method: 'GET',
        headers: { 'api-key': config.apiKey, accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new HevyError(
        aborted ? `Hevy did not answer ${path} within ${config.timeoutMs} ms.` : 'The Hevy API could not be reached.',
        aborted ? 'timeout' : 'network_error'
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      if (attempt < HEVY_RATE_LIMIT_RETRIES) {
        await sleep(HEVY_RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw new HevyError(`Hevy rate-limited ${path} after ${HEVY_RATE_LIMIT_RETRIES} retries.`, 'rate_limited', 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HevyError(
        `Hevy rejected the API key (HTTP ${response.status}). Hevy's API needs a Hevy Pro account and a key from hevy.com/settings?developer.`,
        'unauthorized',
        response.status
      );
    }
    if (!response.ok) {
      let excerpt = '';
      try {
        excerpt = safeExcerpt(await response.text(), [config.apiKey], 160);
      } catch {
        excerpt = '';
      }
      throw new HevyError(
        `Hevy answered HTTP ${response.status} for ${path}.${excerpt ? ` Hevy said: ${excerpt}` : ''}`,
        'http_error',
        response.status
      );
    }

    try {
      const body = (await response.json()) as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('not an object');
      }
      return body as T;
    } catch {
      throw new HevyError(`Hevy returned a body for ${path} that is not a JSON object.`, 'invalid_payload');
    }
  }
}

// ── Wire shapes (only the fields Vital reads) ───────────

export interface HevyWireSet {
  index?: number;
  type?: string;
  weight_kg?: number | null;
  reps?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  rpe?: number | null;
}

export interface HevyWireExercise {
  index?: number;
  title?: string;
  notes?: string | null;
  exercise_template_id?: string;
  sets?: HevyWireSet[];
}

export interface HevyWireWorkout {
  id?: string;
  title?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string;
  updated_at?: string;
  exercises?: HevyWireExercise[];
}

export interface HevyWireTemplate {
  id?: string;
  title?: string;
  type?: string;
  primary_muscle_group?: string;
  secondary_muscle_groups?: string[];
  equipment?: string;
  is_custom?: boolean;
}

export type HevyWireEvent =
  | { type: 'updated'; workout: HevyWireWorkout }
  | { type: 'deleted'; id: string; deleted_at?: string };

interface Paged {
  page?: number;
  page_count?: number;
}

function pageCount(body: Paged): number {
  const n = Number(body.page_count);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function requireArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new HevyError(`Hevy returned a page without a ${what} array.`, 'invalid_payload');
  }
  return value as T[];
}

/**
 * Every workout that started at or after `since`, newest first.
 *
 * /v1/workouts is ordered newest first, so paging stops at the first page whose
 * oldest workout is older than the cut-off.
 */
export async function fetchWorkoutsSince(
  config: HevyConfig,
  sinceIso: string,
  deps: SourceRequestDeps = {}
): Promise<HevyWireWorkout[]> {
  const cutoff = Date.parse(sinceIso);
  const out: HevyWireWorkout[] = [];
  for (let page = 1; page <= HEVY_MAX_PAGES; page++) {
    const body = await hevyGet<Paged & { workouts?: unknown }>(
      config,
      `/v1/workouts?page=${page}&pageSize=${HEVY_WORKOUT_PAGE_SIZE}`,
      deps
    );
    const workouts = requireArray<HevyWireWorkout>(body.workouts, 'workouts');
    let reachedCutoff = false;
    for (const w of workouts) {
      const start = Date.parse(w.start_time ?? '');
      if (Number.isFinite(start) && start < cutoff) {
        reachedCutoff = true;
        continue;
      }
      out.push(w);
    }
    if (reachedCutoff || workouts.length === 0 || page >= pageCount(body)) break;
  }
  return out;
}

/** Every update/delete event since `since`, in the order Hevy returns them (newest first). */
export async function fetchWorkoutEvents(
  config: HevyConfig,
  sinceIso: string,
  deps: SourceRequestDeps = {}
): Promise<HevyWireEvent[]> {
  const out: HevyWireEvent[] = [];
  const since = encodeURIComponent(sinceIso);
  for (let page = 1; page <= HEVY_MAX_PAGES; page++) {
    const body = await hevyGet<Paged & { events?: unknown }>(
      config,
      `/v1/workouts/events?since=${since}&page=${page}&pageSize=${HEVY_WORKOUT_PAGE_SIZE}`,
      deps
    );
    const events = requireArray<HevyWireEvent>(body.events, 'events');
    out.push(...events);
    if (events.length === 0 || page >= pageCount(body)) break;
  }
  return out;
}

export async function fetchExerciseTemplates(
  config: HevyConfig,
  deps: SourceRequestDeps = {}
): Promise<HevyWireTemplate[]> {
  const out: HevyWireTemplate[] = [];
  for (let page = 1; page <= HEVY_MAX_PAGES; page++) {
    const body = await hevyGet<Paged & { exercise_templates?: unknown }>(
      config,
      `/v1/exercise_templates?page=${page}&pageSize=${HEVY_TEMPLATE_PAGE_SIZE}`,
      deps
    );
    const templates = requireArray<HevyWireTemplate>(body.exercise_templates, 'exercise_templates');
    out.push(...templates);
    if (templates.length === 0 || page >= pageCount(body)) break;
  }
  return out;
}
