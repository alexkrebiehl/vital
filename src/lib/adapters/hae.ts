// ── Health Auto Export HTTP client (server-side only) ───
//
// The only module in Vital that knows the upstream wire protocol. It reads
// the stored connection (endpoint and key, encrypted in Postgres, see
// `hae-store.ts`; the environment is never read for them), sends the read token
// as the `api-key` header, validates that the response really is an array of
// records, and never logs a response body or the token.
//
// Endpoints used (verified against the running server, see SPEC §10):
//   GET /api/metrics/:metric   ?from=&to=   → [{ _id, date, qty|Avg|…, units, source }]
//   GET /api/workouts          ?startDate=&endDate=
//                              → [{ id, workout_type, start_time, end_time,
//                                   duration_minutes, calories_burned }]
//   GET /api/workouts/:id      ?include=route,heartRateData
//                              → { route: [{ latitude, longitude, time }],
//                                  heartRateData: [{ timestamp, value }] }
//
// Nothing here is imported by browser code: the client bundle never receives the
// token (see README "Live data" and the bundle check in the verification steps).

import type { PoolLike } from '@/lib/db/pool';
import { readStoredHae, recordHaeOutcome } from './hae-store';
import type { RawSimpleRecord, RawWorkoutRecord } from './normalize';

export type HaeFailureKind =
  | 'not_configured'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_payload';

export class HaeError extends Error {
  constructor(
    message: string,
    readonly kind: HaeFailureKind,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'HaeError';
  }
}

export interface HaeConfig {
  baseUrl: string;
  apiKey: string;
  probeMetric: string;
  ttlSeconds: number;
  /** Timeout for a data request, in ms. */
  timeoutMs: number;
  /** Timeout for the pipeline probe, in ms. */
  probeTimeoutMs: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 1500;
export const DEFAULT_DATA_TIMEOUT_MS = 20_000;

/**
 * The configuration for an endpoint and key. The tuning (probe metric, cache
 * TTL) is plain environment; the endpoint and key are never read from it.
 */
export function buildHaeConfig(
  endpoint: string,
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env
): HaeConfig | null {
  const url = endpoint.trim().replace(/\/+$/, '');
  const key = apiKey.trim();
  if (!url || !key) return null;
  const ttl = Number(env.HAE_CACHE_TTL_SECONDS);
  return {
    baseUrl: url,
    apiKey: key,
    probeMetric: (env.HAE_PROBE_METRIC ?? '').trim() || 'resting_heart_rate',
    ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 300,
    timeoutMs: DEFAULT_DATA_TIMEOUT_MS,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  };
}

/**
 * The connection to use: `deps.haeConfig` when a caller injected one (tests, and
 * the candidate probe of a save), else the stored, encrypted one. Null when not
 * connected or when the stored row cannot be read (it needs re-entry).
 */
export async function resolveHaeConfig(deps: RequestDeps = {}): Promise<HaeConfig | null> {
  if (deps.haeConfig !== undefined) return deps.haeConfig;
  const stored = await readStoredHae({ env: deps.env, haeClient: deps.haeClient });
  if (stored.state !== 'ok') return null;
  return buildHaeConfig(stored.endpoint, stored.apiKey, deps.env ?? process.env);
}

/** Host of the connected API: safe to display, never the key. */
export async function haeHost(deps: RequestDeps = {}): Promise<string | null> {
  const config = await resolveHaeConfig(deps);
  if (!config) return null;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return null;
  }
}

export interface RequestDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Use this connection instead of the stored one (tests, the pre-save probe). `null` = not connected. */
  haeConfig?: HaeConfig | null;
  /** Replaces the process Postgres pool when reading the stored connection (tests). */
  haeClient?: PoolLike | null;
}

export const HAE_NOT_CONNECTED = 'The data source is not connected. Connect it in Settings → Connections.';

function fetchOf(deps: RequestDeps = {}): typeof fetch {
  const impl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof impl !== 'function') {
    throw new HaeError('No fetch implementation is available in this runtime.', 'network_error');
  }
  return impl;
}

/** GET a JSON body from the API, with the shared timeout and error mapping. */
async function haeGetJson(
  pathAndQuery: string,
  deps: RequestDeps = {},
  timeoutMs?: number
): Promise<unknown> {
  const config = await resolveHaeConfig(deps);
  if (!config) throw new HaeError(HAE_NOT_CONNECTED, 'not_configured');
  // Failures of the stored connection feed the Settings card; a candidate probe does not.
  const track = deps.haeConfig === undefined;

  const fetchImpl = fetchOf(deps);
  const controller = new AbortController();
  const limit = timeoutMs ?? config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), limit);
  const url = `${config.baseUrl}${pathAndQuery}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'api-key': config.apiKey, accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const failure = new HaeError(
      aborted
        ? `The Health Auto Export API did not answer within ${limit} ms.`
        : 'The Health Auto Export API could not be reached.',
      aborted ? 'timeout' : 'network_error'
    );
    if (track) recordHaeOutcome({ kind: failure.kind, message: failure.message });
    throw failure;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const failure = new HaeError(
      `The Health Auto Export API answered HTTP ${response.status} for ${pathAndQuery.split('?')[0]}.`,
      'http_error',
      response.status
    );
    if (track) recordHaeOutcome({ kind: failure.kind, message: failure.message });
    throw failure;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    const failure = new HaeError('The Health Auto Export API returned a body that is not JSON.', 'invalid_payload');
    if (track) recordHaeOutcome({ kind: failure.kind, message: failure.message });
    throw failure;
  }

  if (track) recordHaeOutcome(null);
  return body;
}

/**
 * GET a JSON array from the API. A non-array body is an error: silently treating
 * `{error: …}` as "no data" is how a broken source becomes a fabricated zero.
 */
export async function haeGetArray<T>(
  pathAndQuery: string,
  deps: RequestDeps = {},
  timeoutMs?: number
): Promise<T[]> {
  const body = await haeGetJson(pathAndQuery, deps, timeoutMs);
  if (!Array.isArray(body)) {
    throw new HaeError(
      'The Health Auto Export API returned an object where an array of records was expected.',
      'invalid_payload'
    );
  }
  return body as T[];
}

/** GET a JSON object from the API. An array, a scalar or null is an error. */
export async function haeGetObject<T extends object>(
  pathAndQuery: string,
  deps: RequestDeps = {},
  timeoutMs?: number
): Promise<T> {
  const body = await haeGetJson(pathAndQuery, deps, timeoutMs);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HaeError(
      'The Health Auto Export API returned something other than the object that was expected.',
      'invalid_payload'
    );
  }
  return body as T;
}

export interface MetricWindow {
  from?: string;
  to?: string;
}

function metricQuery(window: MetricWindow): string {
  const params = new URLSearchParams();
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** GET /api/metrics/:metric — a bounded window of records. */
export async function fetchMetricRecords(
  haeMetric: string,
  window: MetricWindow = {},
  deps: RequestDeps = {}
): Promise<RawSimpleRecord[]> {
  return haeGetArray<RawSimpleRecord>(
    `/api/metrics/${encodeURIComponent(haeMetric)}${metricQuery(window)}`,
    deps
  );
}

/** GET /api/workouts — note the path is under /api. */
export async function fetchWorkouts(
  window: MetricWindow = {},
  deps: RequestDeps = {}
): Promise<RawWorkoutRecord[]> {
  const params = new URLSearchParams();
  if (window.from) params.set('startDate', window.from);
  if (window.to) params.set('endDate', window.to);
  const qs = params.toString();
  return haeGetArray<RawWorkoutRecord>(`/api/workouts${qs ? `?${qs}` : ''}`, deps);
}

/** One workout's detail: its GPS route and the heart rate sampled during it. */
export interface RawWorkoutDetail {
  route?: { latitude?: number; longitude?: number; time?: string }[];
  heartRateData?: { timestamp?: string; value?: number }[];
}

/**
 * GET /api/workouts/:id — the route and heart rate of one session. The list
 * endpoint carries neither, so a map reads each workout once (see
 * `@/lib/activity-maps/routes`).
 */
export async function fetchWorkoutDetail(id: string, deps: RequestDeps = {}): Promise<RawWorkoutDetail> {
  return haeGetObject<RawWorkoutDetail>(
    `/api/workouts/${encodeURIComponent(id)}?include=route,heartRateData`,
    deps
  );
}

export interface HaeProbeResult {
  outcome: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'invalid_payload';
  httpStatus: number | null;
  durationMs: number;
  /** Records returned by the probe metric — a real observation count. */
  records: number;
  detail: string;
}

/**
 * Bounded read-only probe used by the pipeline panel.
 *
 * A stage may only be marked healthy when this actually succeeded, so the probe
 * asks for a real metric and requires a real array back.
 */
export async function probeHae(deps: RequestDeps = {}, now: () => number = Date.now): Promise<HaeProbeResult> {
  const config = await resolveHaeConfig(deps);
  if (!config) {
    return {
      outcome: 'network_error',
      httpStatus: null,
      durationMs: 0,
      records: 0,
      detail: 'The data source is not connected, so no probe was attempted.',
    };
  }
  const started = now();
  try {
    // A one-week window: enough to prove the endpoint answers with real records
    // while staying tiny in payload.
    const to = new Date(started).toISOString();
    const from = new Date(started - 7 * 86400_000).toISOString();
    const records = await haeGetArray<RawSimpleRecord>(
      `/api/metrics/${encodeURIComponent(config.probeMetric)}${metricQuery({ from, to })}`,
      deps,
      config.probeTimeoutMs
    );
    return {
      outcome: 'ok',
      httpStatus: 200,
      durationMs: now() - started,
      records: records.length,
      detail: `GET /api/metrics/${config.probeMetric} answered with ${records.length} record(s).`,
    };
  } catch (error) {
    const e = error instanceof HaeError ? error : new HaeError('The probe failed.', 'network_error');
    const status = e.httpStatus;
    const outcome: HaeProbeResult['outcome'] =
      e.kind === 'http_error' ? 'http_error'
      : e.kind === 'timeout' ? 'timeout'
      : e.kind === 'invalid_payload' ? 'invalid_payload'
      : 'network_error';
    return {
      outcome,
      httpStatus: status,
      durationMs: now() - started,
      records: 0,
      detail: e.message,
    };
  }
}
