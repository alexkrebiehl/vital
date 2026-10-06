import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OURA_DEFAULT_PREFERRED_FOR,
  preferredGroups,
  preferredMetricIds,
  readOuraConfig,
  type OuraConfig,
} from './config';
import { clearOuraAppCache, saveStoredOuraApp, type StoredOuraApp } from './app-store';
import { fakeTable } from '@/lib/db/credentials-store.fake';

const KEY = randomBytes(32).toString('base64');
const SECRET = 'sample-client-secret-value';
const CALLBACK = 'http://localhost:8080/api/sources/oura/callback';
const ENV = { VITAL_SECRET_KEY: KEY } as unknown as NodeJS.ProcessEnv;
const APP: StoredOuraApp = {
  state: 'ok',
  clientId: 'sample-client-id',
  clientSecret: SECRET,
  redirectUri: CALLBACK,
  loginClientId: null,
};

function envWith(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...ENV, ...extra } as NodeJS.ProcessEnv;
}

async function ok(extra: Record<string, string> = {}, app: StoredOuraApp = APP): Promise<OuraConfig> {
  const r = await readOuraConfig({ env: envWith(extra), ouraApp: app });
  if (!r || !r.ok) throw new Error('expected a usable config');
  return r.config;
}

describe('readOuraConfig', () => {
  it('is disabled (null) when no app credentials are stored', async () => {
    expect(await readOuraConfig({ env: ENV, ouraApp: { state: 'none' } })).toBeNull();
  });

  it('ignores the old OURA_CLIENT_ID, OURA_CLIENT_SECRET and OURA_REDIRECT_URI variables entirely', async () => {
    const env = envWith({ OURA_CLIENT_ID: 'env-id', OURA_CLIENT_SECRET: 'env-secret', OURA_REDIRECT_URI: 'http://localhost/x' });
    expect(await readOuraConfig({ env, ouraApp: { state: 'none' } })).toBeNull();
    const r = await readOuraConfig({ env, ouraApp: APP });
    expect(r && r.ok && r.config).toMatchObject({ clientId: 'sample-client-id', clientSecret: SECRET, redirectUri: CALLBACK });
  });

  it('reads the stored credentials through the injected pool when none is overridden', async () => {
    const db = fakeTable();
    clearOuraAppCache();
    await saveStoredOuraApp({ env: ENV, client: db }, { clientId: 'sample-client-id', clientSecret: SECRET, redirectUri: CALLBACK });
    const r = await readOuraConfig({ env: ENV, client: db });
    expect(r && r.ok && r.config.clientId).toBe('sample-client-id');
    clearOuraAppCache();
  });

  it('says the stored credentials must be entered again when they cannot be read', async () => {
    const r = await readOuraConfig({ env: ENV, ouraApp: { state: 'needs_reentry' } });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('Settings') });
  });

  it('names the key when the secret key is missing or bad', async () => {
    for (const bad of [undefined, 'short', randomBytes(16).toString('base64')]) {
      const env = (bad === undefined ? {} : { VITAL_SECRET_KEY: bad }) as unknown as NodeJS.ProcessEnv;
      expect(await readOuraConfig({ env, ouraApp: APP })).toEqual({
        ok: false,
        reason: expect.stringContaining('VITAL_SECRET_KEY'),
      });
    }
  });

  it('rejects an invalid stored redirect URI or API URL', async () => {
    expect(await readOuraConfig({ env: ENV, ouraApp: { ...APP, redirectUri: 'not a url' } as StoredOuraApp })).toEqual({
      ok: false,
      reason: expect.stringContaining('redirect'),
    });
    expect(await readOuraConfig({ env: envWith({ OURA_API_URL: 'ftp://x' }), ouraApp: APP })).toEqual({
      ok: false,
      reason: expect.stringContaining('OURA_API_URL'),
    });
  });

  it('never puts a secret value in a reason', async () => {
    const cases = [
      { env: ENV, app: { ...APP, redirectUri: 'garbage' } as StoredOuraApp },
      { env: envWith({ VITAL_SECRET_KEY: 'sample-bad-key-value' }), app: APP },
      { env: envWith({ OURA_API_URL: 'gopher://sample-host' }), app: APP },
    ];
    for (const c of cases) {
      const r = await readOuraConfig({ env: c.env, ouraApp: c.app });
      const reason = r && !r.ok ? r.reason : '';
      expect(reason).not.toBe('');
      for (const secret of [SECRET, KEY, 'sample-bad-key-value', 'sample-host', 'garbage']) {
        expect(reason).not.toContain(secret);
      }
    }
  });

  it('applies the defaults', async () => {
    expect(await ok()).toEqual({
      clientId: 'sample-client-id',
      clientSecret: SECRET,
      redirectUri: CALLBACK,
      loginClientId: null,
      scopes: ['daily', 'heartrate', 'workout', 'spo2'],
      apiUrl: 'https://api.ouraring.com',
      cacheTtlSeconds: 300,
      heartrateLookbackDays: 30,
      heartrateChunkDays: 7,
      preferredFor: ['sleep', 'recovery'],
    });
  });

  it('carries the client id the login was issued for', async () => {
    expect((await ok({}, { ...APP, loginClientId: 'older-client' })).loginClientId).toBe('older-client');
  });

  it('reads overrides, trims the API URL slash and falls back on junk numbers', async () => {
    const c = await ok({
      OURA_API_URL: 'https://sandbox.example.test//',
      OURA_SCOPES: 'daily, heartrate',
      OURA_CACHE_TTL_SECONDS: '60',
      OURA_HEARTRATE_LOOKBACK_DAYS: '14',
      OURA_HEARTRATE_CHUNK_DAYS: 'abc',
    });
    expect(c.apiUrl).toBe('https://sandbox.example.test');
    expect(c.scopes).toEqual(['daily', 'heartrate']);
    expect(c.cacheTtlSeconds).toBe(60);
    expect(c.heartrateLookbackDays).toBe(14);
    expect(c.heartrateChunkDays).toBe(7);
    expect((await ok({ OURA_CACHE_TTL_SECONDS: '0' })).cacheTtlSeconds).toBe(300);
    expect((await ok({ OURA_HEARTRATE_CHUNK_DAYS: '1.5' })).heartrateChunkDays).toBe(7);
  });
});

describe('preferredFor', () => {
  it('defaults when unset, and is empty when set but empty', async () => {
    expect(preferredGroups(undefined)).toEqual([...OURA_DEFAULT_PREFERRED_FOR]);
    expect(preferredGroups('')).toEqual([]);
    expect((await ok({ OURA_PREFERRED_FOR: '' })).preferredFor).toEqual([]);
  });

  it('ignores unknown groups, case and duplicates', () => {
    expect(preferredGroups('Sleep, nonsense, heart, sleep')).toEqual(['sleep', 'heart']);
    expect(preferredGroups('scores')).toEqual([]);
  });

  it('maps groups to registry metric ids', () => {
    expect(preferredMetricIds(['sleep', 'recovery'])).toEqual([
      'sleep_analysis',
      'respiratory_rate',
      'blood_oxygen_saturation',
    ]);
    expect(preferredMetricIds(['workouts'])).toEqual([]);
    expect(preferredMetricIds(['activity', 'heart'])).toEqual(['step_count', 'active_energy', 'heart_rate', 'vo2max']);
  });
});
