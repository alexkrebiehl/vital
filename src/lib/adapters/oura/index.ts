// ── Oura source: read-through fetch, probe and status (SERVER ONLY) ─────────
//
// Not re-exported by `adapters/index.ts`: it holds the credential store and the
// Oura client. It reads Oura's API on demand, hands the documents to the pure
// normalizer and returns the contribution. Nothing it reads is stored, and no
// token or health value is ever logged.

import { addDays, dayKey, dayKeyToDate } from '../../analytics/windows';
import { getCredential } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';
import { registerPurger } from '@/lib/sources/purge';
import { DEFAULT_PROBE_TIMEOUT_MS } from '../hae';
import { OuraError, clientDepsFrom, fetchHeartRate, ouraGetAll, type OuraClientDeps } from './client';
import { ouraAppClientFor, type StoredOuraApp } from './app-store';
import { readOuraConfig, type OuraConfig } from './config';
import {
  normalizeOura,
  type OuraContribution,
  type OuraDailyActivityDoc,
  type OuraDailyReadinessDoc,
  type OuraDailySpo2Doc,
  type OuraHeartRateRow,
  type OuraRawBundle,
  type OuraSleepDoc,
  type OuraVo2MaxDoc,
  type OuraWorkoutDoc,
} from './normalize';
import { OURA_SOURCE_ID, OuraNotConnectedError, type TokenDeps } from './tokens';

export interface OuraDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Replaceable in tests; defaults to the process pool. */
  client?: PoolLike | null;
  /** Use these stored app credentials instead of reading them (tests). */
  ouraApp?: StoredOuraApp;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface OuraWindow {
  /** Today in the dataset timezone. */
  referenceKey: string;
  timezone: string;
  lookbackDays: number;
}

/** Which Oura scope each collection needs (`spo2Daily` is the name some replies use). */
const COLLECTION_SCOPES: Record<keyof OuraRawBundle, readonly string[]> = {
  sleep: ['daily'],
  dailyActivity: ['daily'],
  dailyReadiness: ['daily'],
  vo2Max: ['heart_health'],
  dailySpo2: ['spo2', 'spo2Daily'],
  heartrate: ['heartrate'],
  workouts: ['workout'],
};

// ── Last outcome (in memory only; a message, never a value or token) ──

export interface OuraLastError {
  kind: string;
  message: string;
  at: string;
}
const LAST_KEY = Symbol.for('vital.oura.last-error');

function lastStore(): { value: OuraLastError | null } {
  const g = globalThis as unknown as Record<symbol, { value: OuraLastError | null } | undefined>;
  if (!g[LAST_KEY]) g[LAST_KEY] = { value: null };
  return g[LAST_KEY]!;
}

// The last outcome names a kind and a fixed message, never a value; it still
// describes a connection that no longer exists once Oura is removed.
registerPurger('oura.last-outcome', removedIds => {
  if (removedIds.includes('oura')) lastStore().value = null;
});

export function recordOuraOutcome(error: { kind: string; message: string } | null, now: Date = new Date()): void {
  lastStore().value = error ? { kind: error.kind, message: error.message, at: now.toISOString() } : null;
}

export function lastOuraError(): OuraLastError | null {
  return lastStore().value;
}

// ── Wiring ──────────────────────────────────────────────

export interface OuraRuntime {
  config: OuraConfig;
  tokens: TokenDeps;
  client: PoolLike;
}

/** The configuration, pool and key. Throws a typed error when Oura cannot be used. */
export async function ouraRuntime(deps: OuraDeps = {}): Promise<OuraRuntime> {
  const env = deps.env ?? process.env;
  const client = deps.client === undefined ? getPool(env) : deps.client;
  const read = await readOuraConfig({ env, client, ouraApp: deps.ouraApp });
  if (!read || !read.ok) {
    throw new OuraError(read ? read.reason : 'Oura app credentials are not set.', 'not_configured');
  }
  if (!client) throw new OuraNotConnectedError('not_connected');
  // The login was issued for another client ID: Oura would refuse to refresh it.
  if (read.config.loginClientId !== null && read.config.loginClientId !== read.config.clientId) {
    throw new OuraNotConnectedError('needs_reconnect');
  }
  const now = deps.now ? () => deps.now!().getTime() : undefined;
  return {
    config: read.config,
    client,
    tokens: {
      config: read.config,
      client,
      key: readSecretKey(env),
      http: { fetchImpl: deps.fetchImpl, now },
      now,
    },
  };
}

/** Granted scopes of the stored credential, or throws when there is none that can be used. */
async function grantedScopes(rt: OuraRuntime): Promise<string[]> {
  const cred = await getCredential(rt.client, OURA_SOURCE_ID, rt.tokens.key);
  if (!cred) throw new OuraNotConnectedError('not_connected');
  if (cred.needsReconnect) throw new OuraNotConnectedError('needs_reconnect');
  return cred.scopes;
}

function allowed(granted: string[], key: keyof OuraRawBundle): boolean {
  return COLLECTION_SCOPES[key].some(s => granted.includes(s));
}

/** The earliest calendar day any document names, or the fallback. */
function earliestDay(raw: OuraRawBundle, fallback: string, dayOfInstant: (iso: string) => string): string {
  const days: string[] = [];
  for (const rows of [raw.sleep, raw.dailyActivity, raw.dailyReadiness, raw.dailySpo2, raw.vo2Max]) {
    for (const r of (rows ?? []) as { day?: string }[]) if (typeof r.day === 'string') days.push(r.day);
  }
  for (const r of raw.heartrate ?? []) {
    if (typeof r.timestamp === 'string' && Number.isFinite(Date.parse(r.timestamp))) days.push(dayOfInstant(r.timestamp));
  }
  for (const w of raw.workouts ?? []) {
    if (typeof w.start_datetime === 'string' && Number.isFinite(Date.parse(w.start_datetime))) {
      days.push(dayOfInstant(w.start_datetime));
    }
  }
  return days.sort()[0] ?? fallback;
}

/**
 * One read-through pass over Oura for the window: every collection whose scope
 * was granted, normalized into a partial dataset. Throws `OuraError` or
 * `OuraNotConnectedError`; the caller decides what a failure means.
 */
export async function fetchOuraContribution(window: OuraWindow, deps: OuraDeps = {}): Promise<OuraContribution> {
  const rt = await ouraRuntime(deps);
  const granted = await grantedScopes(rt);
  const client: OuraClientDeps = clientDepsFrom(rt.tokens, deps.sleep ? { sleep: deps.sleep } : {});

  const days = {
    start_date: addDays(window.referenceKey, -window.lookbackDays),
    end_date: addDays(window.referenceKey, 1),
  };
  const hrDays = Math.min(window.lookbackDays, rt.config.heartrateLookbackDays);
  const get = <T>(collection: string) => ouraGetAll<T>(collection, days, client);
  const none = async <T>(): Promise<T[]> => [];
  // One collection Oura refuses must not take the others down with it.
  const tolerant = <T>(read: Promise<T[]>): Promise<T[]> =>
    read.catch((error: unknown) => {
      if (error instanceof OuraError && error.kind === 'forbidden') return [];
      throw error;
    });

  const [sleep, dailyActivity, dailyReadiness, dailySpo2, vo2Max, workouts, heartrate] = await Promise.all([
    allowed(granted, 'sleep') ? tolerant(get<OuraSleepDoc>('sleep')) : none<OuraSleepDoc>(),
    allowed(granted, 'dailyActivity') ? tolerant(get<OuraDailyActivityDoc>('daily_activity')) : none<OuraDailyActivityDoc>(),
    allowed(granted, 'dailyReadiness') ? tolerant(get<OuraDailyReadinessDoc>('daily_readiness')) : none<OuraDailyReadinessDoc>(),
    allowed(granted, 'dailySpo2') ? tolerant(get<OuraDailySpo2Doc>('daily_spo2')) : none<OuraDailySpo2Doc>(),
    allowed(granted, 'vo2Max') ? tolerant(get<OuraVo2MaxDoc>('vO2_max')) : none<OuraVo2MaxDoc>(),
    allowed(granted, 'workouts') ? tolerant(get<OuraWorkoutDoc>('workout')) : none<OuraWorkoutDoc>(),
    allowed(granted, 'heartrate')
      ? tolerant(
          fetchHeartRate(
            { start: dayKeyToDate(addDays(window.referenceKey, -hrDays)), end: dayKeyToDate(days.end_date) },
            client
          )
        )
      : none<OuraHeartRateRow>(),
  ]);

  const raw: OuraRawBundle = { sleep, dailyActivity, dailyReadiness, dailySpo2, vo2Max, workouts, heartrate };
  const dayOfInstant = (iso: string) => dayKey(iso, window.timezone);
  return normalizeOura(raw, {
    tz: window.timezone,
    referenceKey: window.referenceKey,
    windowStartKey: earliestDay(raw, window.referenceKey, dayOfInstant),
  });
}

// ── Probe (pipeline stage) ──────────────────────────────

export interface OuraProbeResult {
  outcome: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'invalid_payload' | 'needs_reconnect' | 'not_configured';
  httpStatus: number | null;
  durationMs: number;
  records: number;
  detail: string;
}

/**
 * A real, bounded read: `daily_sleep` for the last two days, 1.5 s timeout. It
 * counts the documents that came back and keeps none of them.
 */
export async function probeOura(deps: OuraDeps = {}, now: () => number = Date.now): Promise<OuraProbeResult> {
  const started = now();
  const elapsed = () => now() - started;
  let rt: OuraRuntime;
  try {
    rt = await ouraRuntime(deps);
    await grantedScopes(rt);
  } catch (error) {
    if (error instanceof OuraNotConnectedError) {
      return { outcome: 'needs_reconnect', httpStatus: null, durationMs: elapsed(), records: 0, detail: error.message };
    }
    return { outcome: 'not_configured', httpStatus: null, durationMs: elapsed(), records: 0, detail: 'Oura is not configured.' };
  }
  try {
    const clock = (deps.now ?? (() => new Date(started)))();
    const today = clock.toISOString().slice(0, 10);
    const client = clientDepsFrom(rt.tokens, deps.sleep ? { sleep: deps.sleep } : {});
    client.http = { ...client.http, timeoutMs: DEFAULT_PROBE_TIMEOUT_MS };
    const docs = await ouraGetAll<unknown>(
      'daily_sleep',
      { start_date: addDays(today, -2), end_date: addDays(today, 1) },
      client
    );
    return {
      outcome: 'ok',
      httpStatus: 200,
      durationMs: elapsed(),
      records: docs.length,
      detail: `GET /v2/usercollection/daily_sleep answered with ${docs.length} record(s).`,
    };
  } catch (error) {
    if (error instanceof OuraNotConnectedError) {
      return { outcome: 'needs_reconnect', httpStatus: null, durationMs: elapsed(), records: 0, detail: error.message };
    }
    const e = error instanceof OuraError ? error : new OuraError('The probe failed.', 'network_error');
    const outcome: OuraProbeResult['outcome'] =
      e.kind === 'timeout' ? 'timeout'
      : e.kind === 'invalid_payload' ? 'invalid_payload'
      : e.kind === 'needs_reconnect' ? 'needs_reconnect'
      : e.kind === 'network_error' ? 'network_error'
      : 'http_error';
    return { outcome, httpStatus: e.httpStatus, durationMs: elapsed(), records: 0, detail: e.message };
  }
}

// ── Status for Settings (no secrets) ────────────────────

export interface OuraStatus {
  configured: boolean;
  /** Configured, but not usable yet: says what is wrong, never a value. */
  configProblem: string | null;
  connected: boolean;
  scopes: string[];
  missingScopes: string[];
  accessExpiresAt: string | null;
  needsReconnect: boolean;
  lastError: { kind: string; message: string } | null;
}

export async function readOuraStatus(deps: OuraDeps = {}): Promise<OuraStatus> {
  const env = deps.env ?? process.env;
  const client = ouraAppClientFor({ env, client: deps.client });
  const read = await readOuraConfig({ env, client, ouraApp: deps.ouraApp });
  const base: OuraStatus = {
    configured: false,
    configProblem: null,
    connected: false,
    scopes: [],
    missingScopes: [],
    accessExpiresAt: null,
    needsReconnect: false,
    lastError: null,
  };
  if (!read) return base;
  if (!read.ok) return { ...base, configProblem: read.reason };

  const last = lastOuraError();
  const lastError = last ? { kind: last.kind, message: last.message } : null;
  const cred = client ? await getCredential(client, OURA_SOURCE_ID, readSecretKey(env)) : null;
  if (!cred) return { ...base, configured: true, needsReconnect: last?.kind === 'needs_reconnect', lastError };
  if (cred.needsReconnect) return { ...base, configured: true, needsReconnect: true, lastError };
  const staleLogin = read.config.loginClientId !== null && read.config.loginClientId !== read.config.clientId;
  return {
    ...base,
    configured: true,
    connected: !staleLogin,
    needsReconnect: staleLogin,
    scopes: cred.scopes,
    missingScopes: read.config.scopes.filter(s => !cred.scopes.includes(s)),
    accessExpiresAt: cred.accessExpiresAt.toISOString(),
    lastError,
  };
}
