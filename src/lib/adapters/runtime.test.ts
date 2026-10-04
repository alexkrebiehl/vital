import { afterEach, describe, expect, it } from 'vitest';
import samples from '@/data/hae-samples.json';
import { resolveDataset, LiveDataUnavailableError } from '@/lib/adapters/runtime';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from '@/lib/db/pool';
import type { SourceContext } from '@/lib/sources/registry';

const KEY = Buffer.alloc(32, 9);
const HAE_TOKEN = 'sample-hae-token';
const OURA_ACCESS = 'sample-oura-access';
const ENV = {
  VITAL_DATA_MODE: 'live',
  HAE_API_URL: 'http://hae.test:3001',
  HAE_API_KEY: HAE_TOKEN,
  OURA_CLIENT_ID: 'sample-client',
  OURA_CLIENT_SECRET: 'sample-secret',
  OURA_REDIRECT_URI: 'http://localhost:8080/api/sources/oura/callback',
  OURA_API_URL: 'http://oura.test',
  VITAL_SECRET_KEY: KEY.toString('base64'),
} as unknown as NodeJS.ProcessEnv;
const NOW = new Date('2026-09-17T18:00:00.000Z');

const pool: PoolLike = (() => {
  const parts = encryptJson({ access_token: OURA_ACCESS, refresh_token: 'sample-refresh' }, KEY);
  const row = {
    source_id: 'oura', ciphertext: parts.ciphertext, iv: parts.iv, auth_tag: parts.authTag, key_id: keyId(KEY),
    scopes: 'daily', access_expires_at: '2099-01-01T00:00:00.000Z', connected_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z', revision: 1,
  };
  return { query: async () => ({ rows: [row] }) };
})();

function fetchWith(oura: 'ok' | 'fail') {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('http://oura.test')) {
      if (oura === 'fail') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ data: [], next_token: null }), { status: 200 });
    }
    const metric = /\/api\/metrics\/([^?]+)/.exec(url)?.[1];
    const body = url.includes('/api/workouts')
      ? samples.workouts
      : ((samples.metrics as unknown as Record<string, unknown[]>)[decodeURIComponent(metric ?? '')] ?? []);
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const ctx = (env: NodeJS.ProcessEnv, connected: boolean): SourceContext => ({
  env,
  hasCredential: async id => connected && id === 'oura',
  labReportCount: async () => 0,
});

afterEach(() => {
  resetToDemoDataset();
  liveCache.clear();
  setCacheTtlForTests(null);
});

describe('resolveDataset with several live sources', () => {
  it('words the summary without naming any source', async () => {
    const resolved = await resolveDataset({
      env: ENV, fetchImpl: fetchWith('ok'), now: () => NOW, timezone: 'UTC', bypassCache: true,
      sources: ctx(ENV, true), ouraClient: pool,
    });
    expect(resolved.meta.summary).toMatch(/^Live data, as of 2026-09-\d\d\. \d+ daily observations across \d+ metrics\.$/);
    expect(resolved.meta.summary).not.toMatch(/oura|health auto export|ring/i);
    expect(resolved.meta.sourceErrors).toBeUndefined();
  });

  it('reports a failed source in the meta and keeps serving the other', async () => {
    const resolved = await resolveDataset({
      env: ENV, fetchImpl: fetchWith('fail'), now: () => NOW, timezone: 'UTC', bypassCache: true,
      sources: ctx(ENV, true), ouraClient: pool,
    });
    expect(resolved.meta.sourceErrors).toEqual([
      { sourceId: 'oura', kind: 'http_error', message: expect.any(String) },
    ]);
    expect(JSON.stringify(resolved.meta)).not.toContain(OURA_ACCESS);
    expect(JSON.stringify(resolved.meta)).not.toContain(HAE_TOKEN);
  });

  it('quotes the merge rule next to the dedupe rule when both sources are read', async () => {
    const resolved = await resolveDataset({
      env: ENV, fetchImpl: fetchWith('ok'), now: () => NOW, timezone: 'UTC', bypassCache: true,
      sources: ctx(ENV, true), ouraClient: pool,
    });
    expect(resolved.meta.dedupe?.rule).toContain('never added or averaged');
  });

  it('keeps the dedupe rule alone for HAE only', async () => {
    const resolved = await resolveDataset({
      env: ENV, fetchImpl: fetchWith('ok'), now: () => NOW, timezone: 'UTC', bypassCache: true,
      sources: ctx(ENV, false), ouraClient: pool,
    });
    expect(resolved.meta.dedupe?.rule).not.toContain('never added or averaged');
  });

  it('tells the reader to connect Oura when nothing else is configured', async () => {
    const env = { ...ENV, HAE_API_URL: '', HAE_API_KEY: '' } as NodeJS.ProcessEnv;
    const error = await resolveDataset({ env, timezone: 'UTC', sources: ctx(env, false) }).catch(e => e);
    expect(error).toBeInstanceOf(LiveDataUnavailableError);
    expect((error as LiveDataUnavailableError).detail).toContain('Connect Oura in Settings');
  });

  it('keeps the original message when no source is configured at all', async () => {
    const env = { VITAL_DATA_MODE: 'live' } as unknown as NodeJS.ProcessEnv;
    const error = await resolveDataset({ env, timezone: 'UTC', sources: ctx(env, false) }).catch(e => e);
    expect(error).toBeInstanceOf(LiveDataUnavailableError);
    expect((error as LiveDataUnavailableError).message).toContain('Health Auto Export API is not configured');
  });
});
