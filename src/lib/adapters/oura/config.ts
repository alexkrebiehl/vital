// ── Oura configuration (SERVER ONLY) ─────────────────────
//
// Read from the environment, never from the client. `readOuraConfig` never
// throws and never puts a value (a secret, a key, a URL) into a reason: a reason
// names the VARIABLE that is wrong, nothing else.

import { readSecretKey } from '@/lib/secrets/crypto';

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

export function readOuraConfig(env: EnvLike = process.env): OuraConfigResult {
  const clientId = text(env, 'OURA_CLIENT_ID');
  if (!clientId) return null;

  const clientSecret = text(env, 'OURA_CLIENT_SECRET');
  if (!clientSecret) return { ok: false, reason: 'OURA_CLIENT_SECRET is not set.' };

  const redirectUri = text(env, 'OURA_REDIRECT_URI');
  if (!redirectUri) return { ok: false, reason: 'OURA_REDIRECT_URI is not set.' };
  if (!validUrl(redirectUri, ['http:', 'https:'])) {
    return { ok: false, reason: 'OURA_REDIRECT_URI is not a valid http(s) URL.' };
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
      clientId,
      clientSecret,
      redirectUri,
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
