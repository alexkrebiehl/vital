import { afterEach, describe, expect, it } from 'vitest';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from '@/lib/db/pool';
import type { StoredOuraApp } from './app-store';
import { lastOuraError, probeOura, readOuraStatus, recordOuraOutcome } from './index';

const KEY = Buffer.alloc(32, 5);
const ACCESS = 'sample-access-token';
const REFRESH = 'sample-refresh-token';
const SECRET = 'sample-client-secret';
const ENV = {
  OURA_API_URL: 'http://oura.test',
  VITAL_SECRET_KEY: KEY.toString('base64'),
} as unknown as NodeJS.ProcessEnv;
const APP: StoredOuraApp = {
  state: 'ok',
  clientId: 'sample-client',
  clientSecret: SECRET,
  redirectUri: 'http://localhost:8080/api/sources/oura/callback',
  loginClientId: null,
};
const NOW = new Date('2026-09-17T18:00:00.000Z');

function poolWith(key: Buffer | null, scopes = 'daily spo2'): PoolLike {
  if (!key) return { query: async () => ({ rows: [] }) };
  const parts = encryptJson({ access_token: ACCESS, refresh_token: REFRESH }, key);
  const row = {
    source_id: 'oura', ciphertext: parts.ciphertext, iv: parts.iv, auth_tag: parts.authTag, key_id: keyId(key),
    scopes, access_expires_at: '2099-01-01T00:00:00.000Z', connected_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z', revision: 1,
  };
  return { query: async () => ({ rows: [row] }) };
}

afterEach(() => recordOuraOutcome(null));

describe('probeOura', () => {
  it('counts the documents of a bounded daily_sleep read', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: [{ day: '2026-09-16' }, { day: '2026-09-17' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await probeOura({ env: ENV, fetchImpl, client: poolWith(KEY), ouraApp: APP, now: () => NOW });
    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 200, records: 2 });
    expect(urls).toHaveLength(1);
    const u = new URL(urls[0]);
    expect(u.pathname).toBe('/v2/usercollection/daily_sleep');
    expect(u.searchParams.get('start_date')).toBe('2026-09-15');
    expect(u.searchParams.get('end_date')).toBe('2026-09-18');
  });

  it('reports an HTTP failure without a token in the detail', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const result = await probeOura({ env: ENV, fetchImpl, client: poolWith(KEY), ouraApp: APP, now: () => NOW });
    expect(result.outcome).toBe('http_error');
    expect(result.httpStatus).toBe(500);
    expect(JSON.stringify(result)).not.toContain(ACCESS);
  });

  it('reports a missing credential as needing a connection, with no request', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const result = await probeOura({ env: ENV, fetchImpl, client: poolWith(null), ouraApp: APP });
    expect(result.outcome).toBe('needs_reconnect');
    expect(called).toBe(false);
  });

  it('makes no request with a login issued for another client id', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const result = await probeOura({ env: ENV, fetchImpl, client: poolWith(KEY), ouraApp: { ...APP, loginClientId: 'older-client' } });
    expect(result.outcome).toBe('needs_reconnect');
    expect(called).toBe(false);
  });

  it('reports an unconfigured source without a request', async () => {
    const result = await probeOura({ env: {} as NodeJS.ProcessEnv, client: poolWith(KEY), ouraApp: APP });
    expect(result.outcome).toBe('not_configured');
  });
});

describe('readOuraStatus', () => {
  it('is empty when Oura is not configured', async () => {
    expect(await readOuraStatus({ env: {} as NodeJS.ProcessEnv, client: null, ouraApp: { state: 'none' } })).toMatchObject({ configured: false, connected: false });
  });

  it('says what is wrong, never a value, when the stored credentials cannot be read', async () => {
    const status = await readOuraStatus({ env: ENV, client: null, ouraApp: { state: 'needs_reentry' } });
    expect(status.configured).toBe(false);
    expect(status.configProblem).toContain('Settings');
  });

  it('needs a reconnect, and is not connected, when the client id changed since the login', async () => {
    const status = await readOuraStatus({ env: ENV, client: poolWith(KEY), ouraApp: { ...APP, loginClientId: 'older-client' } });
    expect(status).toMatchObject({ configured: true, connected: false, needsReconnect: true });
  });

  it('stays connected when the same client id is entered again', async () => {
    const status = await readOuraStatus({ env: ENV, client: poolWith(KEY), ouraApp: { ...APP, loginClientId: 'sample-client' } });
    expect(status).toMatchObject({ configured: true, connected: true, needsReconnect: false });
  });

  it('is ready to connect when configured without a credential', async () => {
    expect(await readOuraStatus({ env: ENV, client: poolWith(null), ouraApp: APP })).toMatchObject({
      configured: true, connected: false, needsReconnect: false,
    });
  });

  it('lists granted and missing scopes and no token', async () => {
    const status = await readOuraStatus({ env: ENV, client: poolWith(KEY), ouraApp: APP });
    expect(status).toMatchObject({
      configured: true, connected: true, scopes: ['daily', 'spo2'], missingScopes: ['heartrate', 'workout'],
      accessExpiresAt: '2099-01-01T00:00:00.000Z', needsReconnect: false,
    });
    const text = JSON.stringify(status);
    for (const secret of [ACCESS, REFRESH, SECRET]) expect(text).not.toContain(secret);
  });

  it('needs a reconnect when the stored credential was written under another key', async () => {
    const status = await readOuraStatus({ env: ENV, client: poolWith(Buffer.alloc(32, 6)), ouraApp: APP });
    expect(status).toMatchObject({ configured: true, connected: false, needsReconnect: true });
  });

  it('carries the last failure message, and clears it on success', async () => {
    recordOuraOutcome({ kind: 'forbidden', message: 'Oura denied access.' }, NOW);
    expect((await readOuraStatus({ env: ENV, client: poolWith(KEY), ouraApp: APP })).lastError).toEqual({
      kind: 'forbidden', message: 'Oura denied access.',
    });
    recordOuraOutcome(null);
    expect(lastOuraError()).toBeNull();
  });
});
