import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OURA_DEFAULT_PREFERRED_FOR,
  preferredGroups,
  preferredMetricIds,
  readOuraConfig,
  type OuraConfig,
} from './config';

const KEY = randomBytes(32).toString('base64');
const BASE = {
  OURA_CLIENT_ID: 'sample-client-id',
  OURA_CLIENT_SECRET: 'sample-client-secret-value',
  OURA_REDIRECT_URI: 'http://localhost:8080/api/sources/oura/callback',
  VITAL_SECRET_KEY: KEY,
};

function ok(env: Record<string, string>): OuraConfig {
  const r = readOuraConfig(env);
  if (!r || !r.ok) throw new Error('expected a usable config');
  return r.config;
}

describe('readOuraConfig', () => {
  it('is disabled (null) when the client id is empty or missing', () => {
    expect(readOuraConfig({})).toBeNull();
    expect(readOuraConfig({ OURA_CLIENT_ID: '   ' })).toBeNull();
    expect(readOuraConfig({ ...BASE, OURA_CLIENT_ID: '' })).toBeNull();
  });

  it('names the variable for each missing piece', () => {
    const { OURA_CLIENT_SECRET: _s, ...noSecret } = BASE;
    const { OURA_REDIRECT_URI: _r, ...noRedirect } = BASE;
    const { VITAL_SECRET_KEY: _k, ...noKey } = BASE;
    expect(readOuraConfig(noSecret)).toEqual({ ok: false, reason: expect.stringContaining('OURA_CLIENT_SECRET') });
    expect(readOuraConfig(noRedirect)).toEqual({ ok: false, reason: expect.stringContaining('OURA_REDIRECT_URI') });
    expect(readOuraConfig(noKey)).toEqual({ ok: false, reason: expect.stringContaining('VITAL_SECRET_KEY') });
  });

  it('rejects a bad secret key with a reason', () => {
    for (const bad of ['short', randomBytes(16).toString('base64'), randomBytes(33).toString('base64')]) {
      expect(readOuraConfig({ ...BASE, VITAL_SECRET_KEY: bad })).toEqual({
        ok: false,
        reason: expect.stringContaining('VITAL_SECRET_KEY'),
      });
    }
  });

  it('rejects an invalid redirect URI or API URL by variable name', () => {
    expect(readOuraConfig({ ...BASE, OURA_REDIRECT_URI: 'not a url' })).toEqual({
      ok: false,
      reason: expect.stringContaining('OURA_REDIRECT_URI'),
    });
    expect(readOuraConfig({ ...BASE, OURA_API_URL: 'ftp://x' })).toEqual({
      ok: false,
      reason: expect.stringContaining('OURA_API_URL'),
    });
  });

  it('never puts a secret value in a reason', () => {
    const cases = [
      { ...BASE, OURA_REDIRECT_URI: 'garbage' },
      { ...BASE, VITAL_SECRET_KEY: 'sample-bad-key-value' },
      { ...BASE, OURA_CLIENT_SECRET: '' },
      { ...BASE, OURA_API_URL: 'gopher://sample-host' },
    ];
    for (const env of cases) {
      const r = readOuraConfig(env);
      const reason = r && !r.ok ? r.reason : '';
      expect(reason).not.toBe('');
      for (const secret of [BASE.OURA_CLIENT_SECRET, KEY, 'sample-bad-key-value', 'sample-host', 'garbage']) {
        expect(reason).not.toContain(secret);
      }
    }
  });

  it('applies the defaults', () => {
    expect(ok(BASE)).toEqual({
      clientId: 'sample-client-id',
      clientSecret: 'sample-client-secret-value',
      redirectUri: BASE.OURA_REDIRECT_URI,
      scopes: ['daily', 'heartrate', 'workout', 'spo2', 'heart_health'],
      apiUrl: 'https://api.ouraring.com',
      cacheTtlSeconds: 300,
      heartrateLookbackDays: 30,
      heartrateChunkDays: 7,
      preferredFor: ['sleep', 'recovery'],
    });
  });

  it('reads overrides, trims the API URL slash and falls back on junk numbers', () => {
    const c = ok({
      ...BASE,
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
    expect(ok({ ...BASE, OURA_CACHE_TTL_SECONDS: '0' }).cacheTtlSeconds).toBe(300);
    expect(ok({ ...BASE, OURA_HEARTRATE_CHUNK_DAYS: '1.5' }).heartrateChunkDays).toBe(7);
  });
});

describe('preferredFor', () => {
  it('defaults when unset, and is empty when set but empty', () => {
    expect(preferredGroups(undefined)).toEqual([...OURA_DEFAULT_PREFERRED_FOR]);
    expect(preferredGroups('')).toEqual([]);
    expect(ok({ ...BASE, OURA_PREFERRED_FOR: '' }).preferredFor).toEqual([]);
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
