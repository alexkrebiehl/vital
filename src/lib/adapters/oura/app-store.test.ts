import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import {
  OURA_APP_SOURCE_ID,
  OURA_APP_CACHE_MS,
  clearOuraAppCache,
  last4OfSecret,
  loginNeedsReconnect,
  readStoredOuraApp,
  removeStoredOuraApp,
  saveStoredOuraApp,
} from './app-store';

const KEY = randomBytes(32);
const env = { VITAL_SECRET_KEY: KEY.toString('base64') } as unknown as NodeJS.ProcessEnv;
const APP = { clientId: 'sample-client', clientSecret: 'sample-secret-abcd1234', redirectUri: 'http://localhost:8080/api/sources/oura/callback' };

let db: ReturnType<typeof fakeTable>;
beforeEach(() => {
  db = fakeTable();
  clearOuraAppCache();
});

describe('Oura app credential store', () => {
  it('reads none when nothing is stored, and none with no database', async () => {
    expect(await readStoredOuraApp({ env, client: db })).toEqual({ state: 'none' });
    expect(await readStoredOuraApp({ env, client: null })).toEqual({ state: 'none' });
  });

  it('stores the three values encrypted under its own row and reads them back', async () => {
    await saveStoredOuraApp({ env, client: db }, APP);
    const row = db.rows.get(OURA_APP_SOURCE_ID)!;
    expect(OURA_APP_SOURCE_ID).toBe('oura-app');
    expect(Buffer.from(row.ciphertext as Buffer).toString('utf8')).not.toContain(APP.clientSecret);
    expect(await readStoredOuraApp({ env, client: db })).toMatchObject({ state: 'ok', ...APP });
    expect(db.rows.has('oura')).toBe(false);
  });

  it('reuses a read for a short while and drops it on save and remove', async () => {
    let t = 1_000;
    await saveStoredOuraApp({ env, client: db }, APP);
    await readStoredOuraApp({ env, client: db, now: () => t });
    const before = db.sent.length;
    await readStoredOuraApp({ env, client: db, now: () => t + OURA_APP_CACHE_MS - 1 });
    expect(db.sent.length).toBe(before);
    await readStoredOuraApp({ env, client: db, now: () => t + OURA_APP_CACHE_MS + 1 });
    expect(db.sent.length).toBeGreaterThan(before);

    await saveStoredOuraApp({ env, client: db }, { ...APP, clientId: 'other-client' });
    expect(await readStoredOuraApp({ env, client: db, now: () => t + OURA_APP_CACHE_MS + 2 })).toMatchObject({ clientId: 'other-client' });
    expect(await removeStoredOuraApp({ env, client: db })).toBe(true);
    expect(await readStoredOuraApp({ env, client: db, now: () => t + OURA_APP_CACHE_MS + 3 })).toEqual({ state: 'none' });
  });

  it('reads a row written under another key as needing re-entry, never throws', async () => {
    await saveStoredOuraApp({ env, client: db }, APP);
    const other = { VITAL_SECRET_KEY: randomBytes(32).toString('base64') } as unknown as NodeJS.ProcessEnv;
    clearOuraAppCache();
    expect(await readStoredOuraApp({ env: other, client: db })).toEqual({ state: 'needs_reentry' });
  });

  it('refuses to store without a usable key or a database', async () => {
    await expect(saveStoredOuraApp({ env: {} as NodeJS.ProcessEnv, client: db }, APP)).rejects.toThrow();
    await expect(saveStoredOuraApp({ env, client: null }, APP)).rejects.toThrow();
  });

  it('binds the login to the client id it was issued for', async () => {
    await saveStoredOuraApp({ env, client: db }, APP, { loginClientId: 'sample-client' });
    const stored = await readStoredOuraApp({ env, client: db });
    expect(stored.state === 'ok' && stored.loginClientId).toBe('sample-client');
    expect(loginNeedsReconnect(stored.state === 'ok' ? stored : null)).toBe(false);
    await saveStoredOuraApp({ env, client: db }, { ...APP, clientId: 'different-client' }, { loginClientId: 'sample-client' });
    const changed = await readStoredOuraApp({ env, client: db });
    expect(loginNeedsReconnect(changed.state === 'ok' ? changed : null)).toBe(true);
  });

  it('treats a login with no recorded client id as matching', () => {
    expect(loginNeedsReconnect({ state: 'ok', ...APP, loginClientId: null })).toBe(false);
    expect(loginNeedsReconnect(null)).toBe(false);
  });

  it('shows the last 4 characters only of a long enough secret', () => {
    expect(last4OfSecret('sample-secret-abcd1234')).toBe('1234');
    expect(last4OfSecret('short')).toBeNull();
  });
});
