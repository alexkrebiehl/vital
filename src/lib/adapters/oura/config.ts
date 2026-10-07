// ── Oura configuration (SERVER ONLY) ─────────────────────
//
// The app credentials (client ID, secret, redirect URI) come from the stored,
// encrypted row; the admin values (scopes, API URL, tuning) from the
// environment. The old per-app environment variables are never read. `readOuraConfig` never throws and never puts a value
// (a secret, a key, a URL) into a reason: a reason names what is wrong, nothing
// else.

import type { PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';
import { readStoredOuraApp, type StoredOuraApp } from './app-store';

export const OURA_DEFAULT_API_URL = 'https://api.ouraring.com';
export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
export const OURA_DEFAULT_SCOPES = ['daily', 'heartrate', 'workout', 'spo2'] as const;
export const OURA_DEFAULT_CACHE_TTL_SECONDS = 300;
export const OURA_DEFAULT_HEARTRATE_LOOKBACK_DAYS = 30;
export const OURA_DEFAULT_HEARTRATE_CHUNK_DAYS = 7;

export const OURA_PREFERENCE_GROUPS = ['sleep', 'recovery', 'activity', 'heart', 'workouts'] as const;
export type OuraPreferenceGroup = (typeof OURA_PREFERENCE_GROUPS)[number];

/** Owner decision: the ring wins for sleep and recovery metrics unless told otherwise. */
export const OURA_DEFAULT_PREFERRED_FOR: readonly OuraPreferenceGroup[] = ['sleep', 'recovery'];

/** Registry metric ids per preference group. `workouts` is the workout list, not a metric. */
export const OURA_GROUP_METRICS: Record<OuraPreferenceGroup, readonly string[]> = {
  sleep: ['sleep_analysis'],
  recovery: ['respiratory_rate', 'blood_oxygen_saturation'],
  activity: ['step_count', 'active_energy'],
  heart: ['heart_rate', 'vo2max'],
  workouts: [],
};

export interface OuraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** The client ID the stored login was issued for; null when none is recorded. */
  loginClientId: string | null;
  scopes: string[];
  /** Without a trailing slash. */
  apiUrl: string;
  cacheTtlSeconds: number;
  heartrateLookbackDays: number;
  heartrateChunkDays: number;
  preferredFor: OuraPreferenceGroup[];
}

export type OuraConfigResult = null | { ok: true; config: OuraConfig } | { ok: false; reason: string };

type EnvLike = Record<string, string | undefined>;

function text(env: EnvLike, name: string): string {
  return (env[name] ?? '').trim();
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Parse `OURA_PREFERRED_FOR`. Unset means the default. Set but empty means `[]`
 * (the watch wins everywhere). Unknown group names are ignored.
 */
export function preferredGroups(raw: string | undefined): OuraPreferenceGroup[] {
  if (raw === undefined) return [...OURA_DEFAULT_PREFERRED_FOR];
  const known = new Set<string>(OURA_PREFERENCE_GROUPS);
  const out: OuraPreferenceGroup[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if (known.has(name) && !out.includes(name as OuraPreferenceGroup)) out.push(name as OuraPreferenceGroup);
  }
  return out;
}

/** The metric ids the ring wins for, given the configured groups. */
export function preferredMetricIds(groups: readonly OuraPreferenceGroup[]): string[] {
  return groups.flatMap(g => [...OURA_GROUP_METRICS[g]]);
}

function validUrl(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export interface OuraConfigDeps {
  env?: EnvLike;
  /** Replaces the process Postgres pool when reading the stored credentials (tests). */
  client?: PoolLike | null;
  /** Use these stored credentials instead of reading them (tests). */
  ouraApp?: StoredOuraApp;
}

/** Combine the stored app credentials with the admin values from the environment. Pure. */
export function buildOuraConfig(env: EnvLike, app: StoredOuraApp): OuraConfigResult {
  if (app.state === 'none') return null;
  if (app.state === 'needs_reentry') {
    return { ok: false, reason: 'The stored Oura app credentials cannot be read. Enter them again in Settings → Connections.' };
  }
  if (!validUrl(app.redirectUri, ['http:', 'https:'])) {
    return { ok: false, reason: 'The stored Oura redirect URI is not a valid http(s) URL.' };
  }

  if (!text(env, 'VITAL_SECRET_KEY')) return { ok: false, reason: 'VITAL_SECRET_KEY is not set.' };
  if (!readSecretKey(env)) {
    return { ok: false, reason: 'VITAL_SECRET_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).' };
  }

  const apiRaw = text(env, 'OURA_API_URL').replace(/\/+$/, '');
  if (apiRaw && !validUrl(apiRaw, ['http:', 'https:'])) {
    return { ok: false, reason: 'OURA_API_URL is not a valid http(s) URL.' };
  }

  const scopes = text(env, 'OURA_SCOPES')
    .split(/[\s,]+/)
    .filter(Boolean);

  return {
    ok: true,
    config: {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUri: app.redirectUri,
      loginClientId: app.loginClientId,
      scopes: scopes.length ? scopes : [...OURA_DEFAULT_SCOPES],
      apiUrl: apiRaw || OURA_DEFAULT_API_URL,
      cacheTtlSeconds: boundedInt(text(env, 'OURA_CACHE_TTL_SECONDS'), OURA_DEFAULT_CACHE_TTL_SECONDS, 1, 86_400),
      heartrateLookbackDays: boundedInt(
        text(env, 'OURA_HEARTRATE_LOOKBACK_DAYS'),
        OURA_DEFAULT_HEARTRATE_LOOKBACK_DAYS,
        1,
        365
      ),
      heartrateChunkDays: boundedInt(
        text(env, 'OURA_HEARTRATE_CHUNK_DAYS'),
        OURA_DEFAULT_HEARTRATE_CHUNK_DAYS,
        1,
        30
      ),
      preferredFor: preferredGroups(env.OURA_PREFERRED_FOR),
    },
  };
}

/** The configuration in force: stored app credentials plus the environment's admin values. */
export async function readOuraConfig(deps: OuraConfigDeps = {}): Promise<OuraConfigResult> {
  const env = deps.env ?? process.env;
  const app = deps.ouraApp ?? (await readStoredOuraApp({ env: env as NodeJS.ProcessEnv, client: deps.client }));
  return buildOuraConfig(env, app);
}
