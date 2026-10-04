// ── Oura data client (SERVER ONLY) ───────────────────────
//
// `ouraGetAll` reads one collection, following `next_token`. Failures are typed
// (`OuraError.kind` mirrors the HAE client's naming) and carry fixed messages:
// no header, token or URL is ever put in one.
//
//   401  one forced refresh and one retry per call, then `needs_reconnect`
//   403  `forbidden`: a scope was not granted, or the membership has lapsed
//   429  wait `Retry-After` seconds (cap 60) if the request's 20 s budget allows
//        it, retry once, else `rate_limited`
//   400/422 `bad_request`; any other status `http_error`
//
// This module returns what Oura sent. It stores nothing and logs nothing.

import { DEFAULT_DATA_TIMEOUT_MS } from '@/lib/adapters/hae';
import type { OuraConfig } from './config';
import { timedFetch, TimedFetchError, type OuraHttpDeps } from './http';
import { getAccessToken, type TokenDeps, type TokenRequest } from './tokens';

export type OuraFailureKind =
  | 'not_configured'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_payload'
  | 'needs_reconnect'
  | 'forbidden'
  | 'rate_limited'
  | 'bad_request'
  | 'too_many_pages';

export class OuraError extends Error {
  constructor(
    message: string,
    readonly kind: OuraFailureKind,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'OuraError';
  }
}

/** At most this many pages per call; more is reported rather than followed. */
export const MAX_PAGES = 50;
/** The longest `Retry-After` honoured, in seconds. */
export const MAX_RETRY_AFTER_SECONDS = 60;

export interface OuraClientDeps {
  config: OuraConfig;
  getToken: (req?: TokenRequest) => Promise<string>;
  http?: OuraHttpDeps;
  /** Replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Client dependencies backed by the stored credential. */
export function clientDepsFrom(tokens: TokenDeps, extra: Pick<OuraClientDeps, 'sleep'> = {}): OuraClientDeps {
  return {
    config: tokens.config,
    getToken: req => getAccessToken(tokens, req),
    http: { ...tokens.http, now: tokens.now ?? tokens.http?.now },
    ...extra,
  };
}

export type QueryParams = Record<string, string | number | undefined>;

interface Page<T> {
  data: T[];
  next_token?: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Math.min(Number(raw.trim()), MAX_RETRY_AFTER_SECONDS);
}

function buildUrl(config: OuraConfig, collection: string, params: QueryParams): string {
  const url = new URL(`${config.apiUrl}/v2/usercollection/${collection}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
  }
  return url.toString();
}

function failureFor(status: number, collection: string): OuraError {
  if (status === 403) {
    return new OuraError("Oura denied access: a scope wasn't granted or the membership has lapsed.", 'forbidden', 403);
  }
  if (status === 400 || status === 422) {
    return new OuraError(`Oura rejected the ${collection} request (HTTP ${status}).`, 'bad_request', status);
  }
  return new OuraError(`Oura returned HTTP ${status} for ${collection}.`, 'http_error', status);
}

async function send(url: string, token: string, timeoutMs: number, deps: OuraClientDeps): Promise<Response> {
  try {
    return await timedFetch(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      { ...deps.http, timeoutMs }
    );
  } catch (error) {
    const kind = error instanceof TimedFetchError ? error.kind : 'network_error';
    throw new OuraError(
      kind === 'timeout' ? 'The Oura request timed out.' : 'The Oura request could not be completed.',
      kind
    );
  }
}

/**
 * One page, with the 401 and 429 handling. `session.token` is the access token
 * in use; a forced refresh replaces it, at most once per `ouraGetAll` call.
 */
async function getPage<T>(
  url: string,
  collection: string,
  session: { token: string; refreshed: boolean },
  deps: OuraClientDeps
): Promise<Page<T>> {
  const now = deps.http?.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const budgetMs = deps.http?.timeoutMs ?? DEFAULT_DATA_TIMEOUT_MS;
  const startedAt = now();
  let retried429 = false;

  for (;;) {
    const remaining = Math.max(budgetMs - (now() - startedAt), 1);
    const res = await send(url, session.token, remaining, deps);

    if (res.status === 401) {
      if (session.refreshed) throw new OuraError('Oura rejected the access token; reconnect it in Settings.', 'needs_reconnect', 401);
      session.refreshed = true;
      session.token = await deps.getToken({ rejectedToken: session.token });
      continue;
    }

    if (res.status === 429) {
      const wait = retryAfterSeconds(res);
      const left = budgetMs - (now() - startedAt);
      if (retried429 || wait === null || wait * 1000 >= left) {
        throw new OuraError('Oura is rate limiting requests; try again shortly.', 'rate_limited', 429);
      }
      retried429 = true;
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) throw failureFor(res.status, collection);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new OuraError(`Oura returned a ${collection} body that is not JSON.`, 'invalid_payload', res.status);
    }
    if (!body || typeof body !== 'object' || !Array.isArray((body as Page<T>).data)) {
      throw new OuraError(`Oura returned a ${collection} body in an unexpected shape.`, 'invalid_payload', res.status);
    }
    return body as Page<T>;
  }
}

/** Every record of a collection, joining its pages. */
export async function ouraGetAll<T>(collection: string, params: QueryParams, deps: OuraClientDeps): Promise<T[]> {
  const session = { token: await deps.getToken(), refreshed: false };
  const out: T[] = [];
  let nextToken: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = buildUrl(deps.config, collection, { ...params, next_token: nextToken ?? undefined });
    const result = await getPage<T>(url, collection, session, deps);
    out.push(...result.data);
    nextToken = result.next_token;
    if (!nextToken) return out;
  }
  throw new OuraError(`Oura ${collection} has more than ${MAX_PAGES} pages; stopped.`, 'too_many_pages');
}

export interface HeartRateSample {
  bpm: number;
  source?: string;
  timestamp: string;
}

const DAY_MS = 86_400_000;

/**
 * Heart-rate samples for [start, end), requested in windows of
 * `heartrateChunkDays` (Oura documents no maximum span). A sample on a window
 * boundary that appears twice is kept once.
 */
export async function fetchHeartRate(
  window: { start: Date; end: Date },
  deps: OuraClientDeps
): Promise<HeartRateSample[]> {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  if (!(endMs > startMs)) return [];
  const step = deps.config.heartrateChunkDays * DAY_MS;
  const seen = new Set<string>();
  const out: HeartRateSample[] = [];
  for (let from = startMs; from < endMs; from += step) {
    const to = Math.min(from + step, endMs);
    const rows = await ouraGetAll<HeartRateSample>(
      'heartrate',
      { start_datetime: new Date(from).toISOString(), end_datetime: new Date(to).toISOString() },
      deps
    );
    for (const row of rows) {
      const id = `${row.timestamp}|${row.source ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}
