import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import type { PoolLike } from '@/lib/db/pool';
import { activeSourceIds, defaultContext } from '@/lib/sources/registry';
import { fetchMetricRecords, haeHost, probeHae, resolveHaeConfig } from './hae';
import {
  HAE_CONFIG_CACHE_MS,
  clearHaeConfigCache,
  lastHaeError,
  readStoredHae,
  recordHaeOutcome,
  removeStoredHae,
  saveStoredHae,
} from './hae-store';

const KEY = randomBytes(32);
const envWith = (key: Buffer | null, extra: Record<string, string> = {}) =>
  ({ ...(key ? { VITAL_SECRET_KEY: key.toString('base64') } : {}), ...extra }) as unknown as NodeJS.ProcessEnv;
const SECRET = 'sample-hae-key-0001';
const ENDPOINT = 'http://sample-host.invalid:3001';

/** Counts the reads that reach the table. */
function counting(db: ReturnType<typeof fakeTable>): PoolLike & { reads: () => number } {
  let reads = 0;
  return {
    reads: () => reads,
    query: (text, params) => {
      if (text.includes('SELECT source_id')) reads += 1;
      return db.query(text, params);
    },
  };
}

beforeEach(() => {
  clearHaeConfigCache();
  recordHaeOutcome(null);
});

describe('resolveHaeConfig', () => {
  it('returns the stored connection, with tuning from the environment', async () => {
    const db = fakeTable();
    const env = envWith(KEY, { HAE_PROBE_METRIC: 'step_count', HAE_CACHE_TTL_SECONDS: '60' });
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    expect(await resolveHaeConfig({ env, haeClient: db })).toMatchObject({
      baseUrl: ENDPOINT,
      apiKey: SECRET,
      probeMetric: 'step_count',
      ttlSeconds: 60,
    });
    expect(await haeHost({ env, haeClient: db })).toBe('sample-host.invalid:3001');
  });

  it('is null when nothing is stored, and when there is no database', async () => {
    expect(await resolveHaeConfig({ env: envWith(KEY), haeClient: fakeTable() })).toBeNull();
    expect(await resolveHaeConfig({ env: envWith(KEY), haeClient: null })).toBeNull();
    expect(await haeHost({ env: envWith(KEY), haeClient: null })).toBeNull();
  });

  it('reads as needs re-entry (null) for another key or no key, and never throws', async () => {
    const db = fakeTable();
    await saveStoredHae({ env: envWith(KEY), haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    clearHaeConfigCache();
    expect(await readStoredHae({ env: envWith(randomBytes(32)), haeClient: db })).toEqual({ state: 'needs_reentry' });
    clearHaeConfigCache();
    expect(await readStoredHae({ env: envWith(null), haeClient: db })).toEqual({ state: 'needs_reentry' });
    expect(await resolveHaeConfig({ env: envWith(null), haeClient: db })).toBeNull();
    clearHaeConfigCache();
    expect(await readStoredHae({ env: envWith('short' as unknown as null), haeClient: db })).toEqual({ state: 'needs_reentry' });
  });

  it('a database failure reads as none and is not cached', async () => {
    let fail = true;
    const db = fakeTable();
    await saveStoredHae({ env: envWith(KEY), haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    clearHaeConfigCache();
    const flaky: PoolLike = { query: (t, p) => (fail ? Promise.reject(new Error('down')) : db.query(t, p)) };
    expect(await readStoredHae({ env: envWith(KEY), haeClient: flaky })).toEqual({ state: 'none' });
    fail = false;
    expect((await readStoredHae({ env: envWith(KEY), haeClient: flaky })).state).toBe('ok');
  });

  it('ignores HAE_API_URL and HAE_API_KEY even when both are set', async () => {
    const env = envWith(KEY, { HAE_API_URL: 'http://env-host.invalid', HAE_API_KEY: 'env-key-value' });
    expect(await resolveHaeConfig({ env, haeClient: fakeTable() })).toBeNull();
    expect(await resolveHaeConfig({ env, haeClient: null })).toBeNull();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('[]');
    }) as unknown as typeof fetch;
    await expect(fetchMetricRecords('step_count', {}, { env, fetchImpl, haeClient: null })).rejects.toMatchObject({
      kind: 'not_configured',
    });
    expect((await probeHae({ env, fetchImpl, haeClient: null })).detail).toMatch(/not connected/);
    expect(calls).toBe(0);
    // With a stored connection, the stored one wins over whatever the environment says.
    const db = fakeTable();
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    expect(await resolveHaeConfig({ env, haeClient: db })).toMatchObject({ baseUrl: ENDPOINT, apiKey: SECRET });
  });
});

describe('cache', () => {
  it('reuses a read for a short time, then reads again', async () => {
    const db = counting(fakeTable());
    const env = envWith(KEY);
    let t = 1_000;
    const deps = { env, haeClient: db, now: () => t };
    await readStoredHae(deps);
    await readStoredHae(deps);
    expect(db.reads()).toBe(1);
    t += HAE_CONFIG_CACHE_MS + 1;
    await readStoredHae(deps);
    expect(db.reads()).toBe(2);
  });

  it('put invalidates immediately', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    expect(await readStoredHae({ env, haeClient: db })).toEqual({ state: 'none' }); // cached
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    expect((await readStoredHae({ env, haeClient: db })).state).toBe('ok');
    await saveStoredHae({ env, haeClient: db }, { endpoint: `${ENDPOINT}/v2`, apiKey: 'sample-next-key' });
    expect(await readStoredHae({ env, haeClient: db })).toMatchObject({ endpoint: `${ENDPOINT}/v2`, apiKey: 'sample-next-key' });
  });

  it('delete invalidates immediately', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    expect((await readStoredHae({ env, haeClient: db })).state).toBe('ok'); // cached
    expect(await removeStoredHae({ env, haeClient: db })).toBe(true);
    expect(await readStoredHae({ env, haeClient: db })).toEqual({ state: 'none' });
  });

  it('keeps the last failure of the stored connection for the Settings card, and clears it on success', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    const down = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchMetricRecords('step_count', {}, { env, haeClient: db, fetchImpl: down })).rejects.toBeTruthy();
    expect(lastHaeError()).toMatchObject({ kind: 'http_error' });
    expect(JSON.stringify(lastHaeError())).not.toContain(SECRET);
    const ok = (async () => new Response('[]')) as unknown as typeof fetch;
    await fetchMetricRecords('step_count', {}, { env, haeClient: db, fetchImpl: ok });
    expect(lastHaeError()).toBeNull();
  });
});

describe('registry', () => {
  it('hae is active when a stored credential exists, and only then', async () => {
    const db = fakeTable();
    const env = envWith(KEY, { HAE_API_URL: ENDPOINT, HAE_API_KEY: SECRET });
    const ctx = { ...defaultContext(env, () => db), labReportCount: async () => 0 };
    expect(await activeSourceIds(ctx)).toEqual([]);
    await saveStoredHae({ env, haeClient: db }, { endpoint: ENDPOINT, apiKey: SECRET });
    expect(await activeSourceIds(ctx)).toEqual(['hae']);
    await removeStoredHae({ env, haeClient: db });
    expect(await activeSourceIds(ctx)).toEqual([]);
  });
});
