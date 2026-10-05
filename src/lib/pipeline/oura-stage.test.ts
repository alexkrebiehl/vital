import { describe, expect, it } from 'vitest';
import { resolvePipelineStatus } from '@/lib/pipeline/status';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from '@/lib/db/pool';
import type { PipelineDatasetSummary } from '@/lib/pipeline/types';

const KEY = Buffer.alloc(32, 3);
const ACCESS = 'sample-oura-access';
const NOW = Date.parse('2026-09-17T18:00:00.000Z');
const OURA_ENV = {
  OURA_CLIENT_ID: 'sample-client',
  OURA_CLIENT_SECRET: 'sample-secret',
  OURA_REDIRECT_URI: 'http://localhost:8080/api/sources/oura/callback',
  OURA_API_URL: 'http://oura.test',
  VITAL_SECRET_KEY: KEY.toString('base64'),
} as unknown as NodeJS.ProcessEnv;
const SUMMARY: PipelineDatasetSummary = {
  source: 'live', observationCount: 12, metricCount: 3, workouts: 0, referenceKey: '2026-09-17',
  windowStartKey: '2026-09-01', timezone: 'UTC', lastObservationAt: '2026-09-17T06:00:00.000Z', error: null,
};

function pool(connected: boolean): PoolLike {
  const parts = encryptJson({ access_token: ACCESS, refresh_token: 'sample-refresh' }, KEY);
  const row = {
    source_id: 'oura', ciphertext: parts.ciphertext, iv: parts.iv, auth_tag: parts.authTag, key_id: keyId(KEY),
    scopes: 'daily', access_expires_at: '2099-01-01T00:00:00.000Z', connected_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z', revision: 1,
  };
  return { query: async () => ({ rows: connected ? [row] : [] }) };
}

function fetchReplying(status: number, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: status === 200 ? [{ day: '2026-09-16' }] : [] }), { status });
  }) as unknown as typeof fetch;
}

const run = (env: NodeJS.ProcessEnv, extra: Parameters<typeof resolvePipelineStatus>[0]) =>
  resolvePipelineStatus({ env, now: () => NOW, skipDataset: true, ...extra });

describe('oura_api pipeline stage', () => {
  it('is unconfigured, with no request, when Oura is not configured', async () => {
    const calls: string[] = [];
    const report = await run({} as NodeJS.ProcessEnv, { fetchImpl: fetchReplying(200, calls), ouraClient: pool(true) });
    const stage = report.stages.find(s => s.id === 'oura_api')!;
    expect(stage.status).toBe('unconfigured');
    expect(stage.detail).toContain('OURA_CLIENT_ID');
    expect(calls).toHaveLength(0);
  });

  it('names the variable that is missing when the configuration is partial', async () => {
    const env = { OURA_CLIENT_ID: 'sample-client' } as unknown as NodeJS.ProcessEnv;
    const stage = (await run(env, {})).stages.find(s => s.id === 'oura_api')!;
    expect(stage.status).toBe('unconfigured');
    expect(stage.detail).toContain('OURA_CLIENT_SECRET');
  });

  it('is unconfigured, with no request, when configured but not connected', async () => {
    const calls: string[] = [];
    const report = await run(OURA_ENV, { fetchImpl: fetchReplying(200, calls), ouraClient: pool(false) });
    const stage = report.stages.find(s => s.id === 'oura_api')!;
    expect(stage.status).toBe('unconfigured');
    expect(stage.detail).toContain('Connect it in Settings');
    expect(calls).toHaveLength(0);
  });

  it('is healthy only when a real probe answered, and counts its records', async () => {
    const calls: string[] = [];
    const report = await run(OURA_ENV, { fetchImpl: fetchReplying(200, calls), ouraClient: pool(true) });
    const stage = report.stages.find(s => s.id === 'oura_api')!;
    expect(stage.status).toBe('healthy');
    expect(stage.detail).toContain('1 record');
    expect(stage.derivedFrom).toContain('daily_sleep');
    expect(stage.derivedFrom).toContain('1500 ms');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).pathname).toBe('/v2/usercollection/daily_sleep');
    expect(JSON.stringify(report)).not.toContain(ACCESS);
  });

  it('is degraded when the probe fails', async () => {
    const report = await run(OURA_ENV, { fetchImpl: fetchReplying(500), ouraClient: pool(true) });
    expect(report.stages.find(s => s.id === 'oura_api')!.status).toBe('degraded');
  });

  it('counts a live Oura-only install as live when Oura answered', async () => {
    const env = { ...OURA_ENV, VITAL_DATA_MODE: 'live' } as NodeJS.ProcessEnv;
    const ok = await run(env, { fetchImpl: fetchReplying(200), ouraClient: pool(true), datasetSummary: SUMMARY });
    expect(ok.summary).toMatch(/^Live mode: \d of \d stages confirmed/);
    const down = await run(env, { fetchImpl: fetchReplying(500), ouraClient: pool(true), datasetSummary: SUMMARY });
    expect(down.summary).toContain('no live source answered');
  });
});
