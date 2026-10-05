import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCredential, putCredential } from '@/lib/db/credentials-store';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import type { OuraConfig } from './config';
import { OuraAuthError, type OuraTokenSet } from './oauth';
import { OuraNotConnectedError, getAccessToken, resetTokenFlightsForTests, type TokenDeps } from './tokens';

const config: OuraConfig = {
  clientId: 'sample-client',
  clientSecret: 'sample-secret',
  redirectUri: 'http://localhost:8080/cb',
  scopes: ['daily'],
  apiUrl: 'https://api.example.test',
  cacheTtlSeconds: 300,
  heartrateLookbackDays: 30,
  heartrateChunkDays: 7,
  preferredFor: [],
};
const NOW = Date.parse('2026-10-04T12:00:00Z');
const key = randomBytes(32);
const PAST = new Date(NOW - 1000);
const FUTURE = new Date(NOW + 3_600_000);

beforeEach(() => resetTokenFlightsForTests());

function setup(opts: { expiresAt?: Date; refresh?: TokenDeps['refresh'] } = {}) {
  const db = fakeTable();
  const calls: string[] = [];
  const refresh: TokenDeps['refresh'] =
    opts.refresh ??
    (async (_cfg, rt): Promise<OuraTokenSet> => {
      calls.push(rt);
      await new Promise(r => setTimeout(r, 10));
      return { accessToken: 'sample-at-2', refreshToken: 'sample-rt-2', expiresAt: FUTURE, scopes: null };
    });
  const deps: TokenDeps = { config, client: db, key, now: () => NOW, refresh };
  return {
    db,
    calls,
    deps,
    seed: () =>
      putCredential(db, 'oura', { accessToken: 'sample-at-1', refreshToken: 'sample-rt-1' }, ['daily', 'spo2'], opts.expiresAt ?? PAST, key),
  };
}

describe('getAccessToken', () => {
  it('throws OuraNotConnectedError when there is no credential', async () => {
    const { deps } = setup();
    await expect(getAccessToken(deps)).rejects.toMatchObject({ name: 'OuraNotConnectedError', reason: 'not_connected' });
  });

  it('returns an unexpired token without refreshing or locking', async () => {
    const { deps, calls, seed, db } = setup({ expiresAt: FUTURE });
    await seed();
    db.sent.length = 0;
    expect(await getAccessToken(deps)).toBe('sample-at-1');
    expect(calls).toEqual([]);
    expect(db.sent.some(s => /FOR UPDATE|BEGIN/.test(s.text))).toBe(false);
  });

  it('reports needs_reconnect for a row written under another key, and leaves the row', async () => {
    const { deps, db } = setup();
    await putCredential(db, 'oura', { accessToken: 'a', refreshToken: 'r' }, [], FUTURE, randomBytes(32));
    const err = await getAccessToken(deps).catch(e => e);
    expect(err).toBeInstanceOf(OuraNotConnectedError);
    expect(err.reason).toBe('needs_reconnect');
    expect(db.rows.size).toBe(1);
  });

  it('refreshes an expired token once for two concurrent callers', async () => {
    const { deps, calls, seed } = setup();
    await seed();
    const [a, b] = await Promise.all([getAccessToken(deps), getAccessToken(deps)]);
    expect(a).toBe('sample-at-2');
    expect(b).toBe('sample-at-2');
    expect(calls).toEqual(['sample-rt-1']);
  });

  it('stores the new refresh token, keeping the granted scopes, before the access token is returned', async () => {
    const { deps, seed, db } = setup();
    await seed();
    db.sent.length = 0;
    const token = await getAccessToken(deps);
    expect(token).toBe('sample-at-2');
    const stored = await getCredential(db, 'oura', key);
    expect(stored).toMatchObject({
      tokens: { accessToken: 'sample-at-2', refreshToken: 'sample-rt-2' },
      scopes: ['daily', 'spo2'],
      revision: 2,
    });
    const texts = db.sent.map(s => s.text.replace(/\s+/g, ' ').trim());
    const insert = texts.findIndex(t => t.startsWith('INSERT'));
    const commit = texts.lastIndexOf('COMMIT');
    expect(insert).toBeGreaterThan(texts.findIndex(t => t.endsWith('FOR UPDATE')));
    expect(commit).toBeGreaterThan(insert);
  });

  it('uses the scopes from the refresh reply when it gives them', async () => {
    const { deps, seed, db } = setup({
      refresh: async () => ({ accessToken: 'x', refreshToken: 'y', expiresAt: FUTURE, scopes: ['daily'] }),
    });
    await seed();
    await getAccessToken(deps);
    expect(await getCredential(db, 'oura', key)).toMatchObject({ scopes: ['daily'] });
  });

  it('re-checks expiry inside the lock and does not spend the refresh token if another caller already did', async () => {
    const { deps, calls, seed, db } = setup();
    await seed();
    const real = db.query.bind(db);
    let raced = false;
    db.query = async (text, params) => {
      if (!raced && /FOR UPDATE/.test(text)) {
        raced = true;
        // Another caller refreshed between our unlocked read and our lock.
        await putCredential(db, 'oura', { accessToken: 'sample-at-other', refreshToken: 'sample-rt-other' }, ['daily'], FUTURE, key);
      }
      return real(text, params);
    };
    expect(await getAccessToken(deps)).toBe('sample-at-other');
    expect(calls).toEqual([]);
  });

  it('deletes the row and reports needs_reconnect when Oura rejects the refresh', async () => {
    const { deps, seed, db } = setup({
      refresh: async () => {
        throw new OuraAuthError('Oura token refresh was rejected (HTTP 400, invalid_grant).', 'rejected', 400);
      },
    });
    await seed();
    const err = await getAccessToken(deps).catch(e => e);
    expect(err).toBeInstanceOf(OuraNotConnectedError);
    expect(err.reason).toBe('needs_reconnect');
    expect(db.rows.size).toBe(0);
    expect(db.sent.map(s => s.text).at(-1)).toBe('COMMIT');
  });

  it('keeps the row and rethrows on a transient refresh failure', async () => {
    const { deps, seed, db } = setup({
      refresh: async () => {
        throw new OuraAuthError('Oura token refresh failed: network error.', 'network_error');
      },
    });
    await seed();
    const err = await getAccessToken(deps).catch(e => e);
    expect(err).toBeInstanceOf(OuraAuthError);
    expect(err.kind).toBe('network_error');
    expect(db.rows.size).toBe(1);
    expect(db.sent.map(s => s.text).at(-1)).toBe('ROLLBACK');
  });

  it('forces a refresh when the API refused the stored token, but not when it was already replaced', async () => {
    const forced = setup({ expiresAt: FUTURE });
    await forced.seed();
    expect(await getAccessToken(forced.deps, { rejectedToken: 'sample-at-1' })).toBe('sample-at-2');
    expect(forced.calls).toEqual(['sample-rt-1']);

    resetTokenFlightsForTests();
    const replaced = setup({ expiresAt: FUTURE });
    await replaced.seed();
    expect(await getAccessToken(replaced.deps, { rejectedToken: 'an-older-token' })).toBe('sample-at-1');
    expect(replaced.calls).toEqual([]);
  });

  it('never puts a token in an error it raises', async () => {
    const { deps, seed } = setup({
      refresh: async () => {
        throw new OuraAuthError('Oura token refresh was rejected (HTTP 401).', 'rejected', 401);
      },
    });
    await seed();
    const err = await getAccessToken(deps).catch(e => e);
    for (const secret of ['sample-at-1', 'sample-rt-1']) expect(String(err.message)).not.toContain(secret);
  });

  it('clears its single-flight entry so a later expiry refreshes again', async () => {
    const { deps, calls, seed, db } = setup();
    await seed();
    await getAccessToken(deps);
    await putCredential(db, 'oura', { accessToken: 'sample-at-3', refreshToken: 'sample-rt-3' }, [], PAST, key);
    await getAccessToken(deps);
    expect(calls).toEqual(['sample-rt-1', 'sample-rt-3']);
  });
});
