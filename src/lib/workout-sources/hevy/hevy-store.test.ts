import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import type { PoolLike } from '@/lib/db/pool';
import { activeSourceIds, defaultContext } from '@/lib/sources/registry';
import { loadTrainingData, resetTrainingStoreForTests } from '../store';
import { hevyHost, hevyGet, readHevyConfig } from './client';
import {
  HEVY_CONFIG_CACHE_MS,
  clearHevyConfigCache,
  lastHevyError,
  readStoredHevy,
  recordHevyOutcome,
  removeStoredHevy,
  saveStoredHevy,
} from './hevy-store';

const KEY = randomBytes(32);
const envWith = (key: Buffer | null, extra: Record<string, string> = {}) =>
  ({ ...(key ? { VITAL_SECRET_KEY: key.toString('base64') } : {}), ...extra }) as unknown as NodeJS.ProcessEnv;
const SECRET = 'sample-hevy-key-0001';
const URL_ = 'http://hevy-sample.invalid:4000';

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
  clearHevyConfigCache();
  recordHevyOutcome(null);
  resetTrainingStoreForTests();
});

describe('readHevyConfig', () => {
  it('returns the stored connection, with the cache TTL from the environment', async () => {
    const db = fakeTable();
    const env = envWith(KEY, { HEVY_CACHE_TTL_SECONDS: '60' });
    await saveStoredHevy({ env, hevyClient: db }, { apiKey: SECRET, url: URL_ });
    const config = await readHevyConfig({ env, hevyClient: db });
    expect(config).toMatchObject({ baseUrl: URL_, apiKey: SECRET, ttlSeconds: 60 });
    expect(hevyHost(config!)).toBe('hevy-sample.invalid:4000');
  });

  it('a blank stored URL means the Hevy API', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    await saveStoredHevy({ env, hevyClient: db }, { apiKey: SECRET, url: '' });
    expect((await readHevyConfig({ env, hevyClient: db }))?.baseUrl).toBe('https://api.hevyapp.com');
  });

  it('is null when nothing is stored, and when there is no database', async () => {
    expect(await readHevyConfig({ env: envWith(KEY), hevyClient: fakeTable() })).toBeNull();
    expect(await readHevyConfig({ env: envWith(KEY), hevyClient: null })).toBeNull();
  });

  it('reads as needs re-entry (null) for another key or no key, and never throws', async () => {
    const db = fakeTable();
    await saveStoredHevy({ env: envWith(KEY), hevyClient: db }, { apiKey: SECRET, url: '' });
    clearHevyConfigCache();
    expect(await readStoredHevy({ env: envWith(randomBytes(32)), hevyClient: db })).toEqual({ state: 'needs_reentry' });
    clearHevyConfigCache();
    expect(await readStoredHevy({ env: envWith(null), hevyClient: db })).toEqual({ state: 'needs_reentry' });
    expect(await readHevyConfig({ env: envWith(null), hevyClient: db })).toBeNull();
  });

  it('a database failure reads as none and is not cached', async () => {
    let fail = true;
    const db = fakeTable();
    await saveStoredHevy({ env: envWith(KEY), hevyClient: db }, { apiKey: SECRET, url: '' });
    clearHevyConfigCache();
    const flaky: PoolLike = { query: (t, p) => (fail ? Promise.reject(new Error('down')) : db.query(t, p)) };
    expect(await readStoredHevy({ env: envWith(KEY), hevyClient: flaky })).toEqual({ state: 'none' });
    fail = false;
    expect((await readStoredHevy({ env: envWith(KEY), hevyClient: flaky })).state).toBe('ok');
  });

  it('ignores HEVY_API_KEY and HEVY_API_URL even when both are set', async () => {
    const env = envWith(KEY, { HEVY_API_KEY: 'env-key-value', HEVY_API_URL: 'http://env-host.invalid' });
    expect(await readHevyConfig({ env, hevyClient: fakeTable() })).toBeNull();
    expect(await readHevyConfig({ env, hevyClient: null })).toBeNull();

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const live = envWith(KEY, { VITAL_DATA_MODE: 'live', HEVY_API_KEY: 'env-key-value' });
    const data = await loadTrainingData({ env: live, fetchImpl, hevyClient: null });
    expect(data.statuses[0]).toMatchObject({ configured: false, origin: 'none' });
    expect(calls).toBe(0);

    // With a stored connection, the stored one wins over whatever the environment says.
    const db = fakeTable();
    await saveStoredHevy({ env, hevyClient: db }, { apiKey: SECRET, url: URL_ });
    expect(await readHevyConfig({ env, hevyClient: db })).toMatchObject({ baseUrl: URL_, apiKey: SECRET });
  });

  it('sends the stored key to the stored URL', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    await saveStoredHevy({ env, hevyClient: db }, { apiKey: SECRET, url: URL_ });
    const config = (await readHevyConfig({ env, hevyClient: db }))!;
    let seen: { url: string; key: string } | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), key: String((init?.headers as Record<string, string>)['api-key']) };
      return new Response('{}');
    }) as unknown as typeof fetch;
    await hevyGet(config, '/v1/user/info', { fetchImpl });
    expect(seen).toEqual({ url: `${URL_}/v1/user/info`, key: SECRET });
  });
});

describe('cache', () => {
  it('reuses a read for a short time, then reads again', async () => {
    const db = counting(fakeTable());
    let t = 1_000;
    const deps = { env: envWith(KEY), hevyClient: db, now: () => t };
    await readStoredHevy(deps);
    await readStoredHevy(deps);
    expect(db.reads()).toBe(1);
    t += HEVY_CONFIG_CACHE_MS + 1;
    await readStoredHevy(deps);
    expect(db.reads()).toBe(2);
  });

  it('save and remove invalidate it immediately', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    const deps = { env, hevyClient: db, now: () => 1_000 };
    expect((await readStoredHevy(deps)).state).toBe('none');
    await saveStoredHevy(deps, { apiKey: SECRET, url: '' });
    expect((await readStoredHevy(deps)).state).toBe('ok');
    expect(await removeStoredHevy(deps)).toBe(true);
    expect((await readStoredHevy(deps)).state).toBe('none');
    expect(await removeStoredHevy(deps)).toBe(false);
  });
});

describe('storage', () => {
  it('stores the key encrypted, under source id hevy, with no plaintext in the row', async () => {
    const db = fakeTable();
    await saveStoredHevy({ env: envWith(KEY), hevyClient: db }, { apiKey: SECRET, url: URL_ });
    expect([...db.rows.keys()]).toEqual(['hevy']);
    const flat = JSON.stringify([...db.rows.values()].map(r => Object.values(r).map(v => (Buffer.isBuffer(v) ? v.toString('latin1') : v))));
    expect(flat).not.toContain(SECRET);
  });

  it('save throws without a key or a database, and keeps the last error out of it', async () => {
    await expect(saveStoredHevy({ env: envWith(null), hevyClient: fakeTable() }, { apiKey: SECRET, url: '' })).rejects.toThrow();
    await expect(saveStoredHevy({ env: envWith(KEY), hevyClient: null }, { apiKey: SECRET, url: '' })).rejects.toThrow();
    recordHevyOutcome({ kind: 'unauthorised', message: 'x' });
    expect(lastHevyError()).toEqual({ kind: 'unauthorised', message: 'x' });
    await saveStoredHevy({ env: envWith(KEY), hevyClient: fakeTable() }, { apiKey: SECRET, url: '' });
    expect(lastHevyError()).toBeNull();
  });
});

describe('registry', () => {
  it('hevy is active exactly when the row exists', async () => {
    const db = fakeTable();
    const env = envWith(KEY);
    const ctx = () => ({ ...defaultContext(env, () => db), labReportCount: async () => 0 });
    expect(await activeSourceIds(ctx())).toEqual([]);
    await saveStoredHevy({ env, hevyClient: db }, { apiKey: SECRET, url: '' });
    expect(await activeSourceIds(ctx())).toEqual(['hevy']);
    await removeStoredHevy({ env, hevyClient: db });
    expect(await activeSourceIds(ctx())).toEqual([]);
  });
});
