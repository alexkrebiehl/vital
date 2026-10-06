// ── "Removed means it never existed" (plan §8, Task C2) ───────────────────
//
// The most important test of Phase C. A dataset built from {hae, oura}, then
// oura removed and rebuilt THROUGH THE CACHES, must deep-equal a dataset built
// from {hae} alone, and the string `Oura Ring` must appear nowhere in it.
// All data here is synthetic; nothing calls a real API.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import samples from '@/data/hae-samples.json';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { buildHaeConfig } from '@/lib/adapters/hae';
import { loadLiveDataset, fetchLiveDatasetUncached } from '@/lib/adapters/live';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from '@/lib/db/pool';
import type { SourceContext } from '@/lib/sources/registry';
import { reconcileActiveSources, resetPurgeStateForTests } from '@/lib/sources/purge';

const NOW = new Date('2026-09-17T18:00:00.000Z');
const METRICS = samples.metrics as unknown as Record<string, unknown[]>;
const SECRET_KEY = Buffer.alloc(32, 7);
const HAE_ENV = {
  HAE_CACHE_TTL_SECONDS: '300',
  VITAL_DATA_MODE: 'live',
} as unknown as NodeJS.ProcessEnv;
const OURA_ENV = {
  OURA_CLIENT_ID: 'sample-client',
  OURA_CLIENT_SECRET: 'sample-client-secret',
  OURA_REDIRECT_URI: 'http://localhost:8080/api/sources/oura/callback',
  OURA_API_URL: 'http://oura.test',
  VITAL_SECRET_KEY: SECRET_KEY.toString('base64'),
} as unknown as NodeJS.ProcessEnv;
const BOTH_ENV = { ...HAE_ENV, ...OURA_ENV } as NodeJS.ProcessEnv;

const OURA_DOCS: Record<string, unknown[]> = {
  sleep: [
    {
      id: 's1',
      day: '2026-09-17',
      type: 'long_sleep',
      bedtime_start: '2026-09-16T23:00:00+00:00',
      bedtime_end: '2026-09-17T06:30:00+00:00',
      time_in_bed: 27000,
      total_sleep_duration: 24000,
      deep_sleep_duration: 5000,
      light_sleep_duration: 14000,
      rem_sleep_duration: 5000,
      awake_time: 3000,
      average_breath: 14.5,
      average_hrv: 48,
      lowest_heart_rate: 51,
    },
  ],
  daily_activity: [{ day: '2026-09-16', steps: 8123, active_calories: 430 }],
  daily_readiness: [{ day: '2026-09-16', temperature_deviation: -0.2 }],
  workout: [
    {
      id: 'w1',
      activity: 'walking',
      start_datetime: '2026-09-16T17:45:00+00:00',
      end_datetime: '2026-09-16T18:20:00+00:00',
      calories: 90,
    },
  ],
};

function upstream(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('http://oura.test')) {
      const name = /usercollection\/([^?]+)/.exec(url)?.[1] ?? '';
      return new Response(JSON.stringify({ data: OURA_DOCS[name] ?? [], next_token: null }), { status: 200 });
    }
    const body = url.includes('/api/workouts')
      ? samples.workouts
      : (METRICS[decodeURIComponent(/\/api\/metrics\/([^?]+)/.exec(url)?.[1] ?? '')] ?? []);
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

function credentialPool(): PoolLike {
  const parts = encryptJson({ access_token: 'sample-access', refresh_token: 'sample-refresh' }, SECRET_KEY);
  const row = {
    source_id: 'oura',
    ciphertext: parts.ciphertext,
    iv: parts.iv,
    auth_tag: parts.authTag,
    key_id: keyId(SECRET_KEY),
    scopes: 'daily heartrate workout spo2',
    access_expires_at: '2099-01-01T00:00:00.000Z',
    connected_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    revision: 1,
  };
  return { query: async () => ({ rows: [row] }) };
}

// Environments in which the Health Auto Export connection is stored (it is never read from the environment).
const HAE_ENVS = new Set<NodeJS.ProcessEnv>([HAE_ENV, BOTH_ENV]);

function ctx(env: NodeJS.ProcessEnv, ouraConnected: boolean): SourceContext {
  return { env, hasCredential: async id => (HAE_ENVS.has(env) && id === 'hae') || (ouraConnected && id === 'oura'), labReportCount: async () => 0 };
}

function deps(env: NodeJS.ProcessEnv, ouraConnected: boolean) {
  return {
    env,
    fetchImpl: upstream(),
    now: () => NOW,
    timezone: 'UTC',
    sources: ctx(env, ouraConnected),
    haeConfig: buildHaeConfig('http://hae.test:3001', 'sample-hae-key', env),
    ouraClient: credentialPool(),
  };
}

/** Everything the live caches hold, as text. */
function heldText(): string {
  return JSON.stringify(liveCache.stats().keys.map(k => liveCache.peek(k)));
}

describe('removal means it never existed (dataset level)', () => {
  beforeEach(() => {
    resetPurgeStateForTests();
    liveCache.clear();
    setCacheTtlForTests(60_000);
  });
  afterEach(() => {
    liveCache.clear();
    setCacheTtlForTests(null);
    resetPurgeStateForTests();
  });

  it('a dataset rebuilt after Oura is disconnected deep-equals a {hae}-only build', async () => {
    await reconcileActiveSources(ctx(BOTH_ENV, true));
    const withOura = await loadLiveDataset(deps(BOTH_ENV, true));
    // The setup is real: Oura contributed.
    expect(JSON.stringify(withOura)).toContain('Oura Ring');
    expect(liveCache.stats().keys.some(k => k.startsWith('oura:'))).toBe(true);

    // Disconnect: the credential row is gone, the configuration remains.
    const outcome = await reconcileActiveSources(ctx(BOTH_ENV, false));
    expect(outcome.removed).toEqual(['oura']);
    expect(liveCache.stats().keys.filter(k => k.startsWith('oura:'))).toEqual([]);
    expect(heldText()).not.toContain('Oura Ring');

    const rebuilt = await loadLiveDataset(deps(BOTH_ENV, false));

    // The reference: a process that only ever had HAE.
    resetPurgeStateForTests();
    liveCache.clear();
    const haeOnly = await fetchLiveDatasetUncached(deps(HAE_ENV, false));

    expect(rebuilt).toEqual(haeOnly);
    expect(JSON.stringify(rebuilt)).not.toContain('Oura Ring');
    expect(JSON.stringify(rebuilt)).not.toMatch(/oura/i);
    expect(heldText()).not.toContain('Oura Ring');
  });

  it('removing the configuration (not only the credential) gives the same result', async () => {
    await reconcileActiveSources(ctx(BOTH_ENV, true));
    await loadLiveDataset(deps(BOTH_ENV, true));

    const outcome = await reconcileActiveSources(ctx(HAE_ENV, true));
    expect(outcome.removed).toEqual(['oura']);
    const rebuilt = await loadLiveDataset(deps(HAE_ENV, true));

    resetPurgeStateForTests();
    liveCache.clear();
    const haeOnly = await fetchLiveDatasetUncached(deps(HAE_ENV, false));

    expect(rebuilt).toEqual(haeOnly);
    expect(JSON.stringify(rebuilt)).not.toContain('Oura Ring');
    expect(heldText()).not.toContain('Oura Ring');
  });

  it('removing HAE leaves exactly the Oura-only dataset, with no watch name in it', async () => {
    await reconcileActiveSources(ctx(BOTH_ENV, true));
    const both = await loadLiveDataset(deps(BOTH_ENV, true));
    const haeNames = both.sources.filter(n => n !== 'Oura Ring');
    expect(haeNames.length).toBeGreaterThan(0);

    const ouraEnv = { ...OURA_ENV, VITAL_DATA_MODE: 'live' } as NodeJS.ProcessEnv;
    const outcome = await reconcileActiveSources(ctx(ouraEnv, true));
    expect(outcome.removed).toEqual(['hae']);
    const rebuilt = await loadLiveDataset(deps(ouraEnv, true));

    resetPurgeStateForTests();
    liveCache.clear();
    const ouraOnly = await fetchLiveDatasetUncached(deps(ouraEnv, true));

    expect(rebuilt).toEqual(ouraOnly);
    const text = JSON.stringify(rebuilt);
    for (const name of haeNames) expect(text).not.toContain(name);
  });
});
