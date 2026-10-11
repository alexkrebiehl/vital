// ── get_app_data: app.data_quality and app.pipeline ─────────────────────────
//
// The quality findings the Settings panel shows (silenced ones marked), and the
// pipeline report cut down to what the model may know: no host, URL, key, probe body
// or raw error. app.pipeline is the one capability that names a source.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { installBodyDataset } from './app.fake';
import { allReaders } from './app-state.fake';
import { appCtxWith } from './app-ctx.fake';
import { HOST, PIPELINE, QUALITY, REPORT, TOKEN } from './app-status.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import { expectClean } from './test-context.fake';
import type { CapabilityContext } from './types';

// A credential the process holds is removed wherever an upstream message echoes it (design §9.1).
beforeEach(() => {
  installBodyDataset();
  vi.stubEnv('HAE_API_KEY', TOKEN);
});
afterEach(() => {
  resetToDemoDataset();
  vi.unstubAllEnvs();
});

const read = (id: string, args: Record<string, unknown> = {}, ctx: CapabilityContext = appCtxWith()): Promise<Envelope<unknown>> => capabilityById(id)!.read(args, ctx);
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;
const SOURCE_NAME = /health auto export|\boura\b|\bhevy\b/i;

describe('app.data_quality', () => {
  it('lists the findings with their metrics, days and fixes, and marks the silenced ones', async () => {
    const env = await read('app.data_quality');
    expectClean(env);
    const findings = data(env).findings as Record<string, any>[];
    expect(findings[0]).toMatchObject({ silenced: false, severity: 'warning', title: 'Days are missing from the export', metrics: ['Steps'], days: '3 days', ranges: ['2026-09-01 to 2026-09-03'] });
    expect(findings[0].fix).toHaveLength(2);
    expect(findings.find(f => f.silenced)).toMatchObject({ silenced: true, title: 'Food log starts late' });
    expect(data(env).checks).toEqual([
      { check: 'New data arriving', outcome: 'pass', summary: 'Data arrived in the last day.' },
      { check: 'Missing days', outcome: 'flagged', summary: '3 days missing.' },
    ]);
  });

  it('names no data source and no address, even where the finding\'s own words do', async () => {
    expect(REPORT.findings[0].remedy.join(' ')).toMatch(SOURCE_NAME);
    const text = JSON.stringify(await read('app.data_quality'));
    expect(text).not.toMatch(SOURCE_NAME);
    expect(text).not.toContain(HOST);
  });

  it('answers a clean report as a clean answer, not as no data', async () => {
    const clean = { ...QUALITY, quality: { checks: REPORT.checks.map(c => ({ ...c, outcome: 'pass' as const })), findings: [] }, silenced: [] };
    const env = await read('app.data_quality', {}, appCtxWith(allReaders({ quality: async () => clean })));
    expect(env.status).toBe('ok');
    expect(data(env).findings).toEqual([]);
    expect(data(env).summary).toBe('All 2 checks passed.');
  });

  it.each([
    ['computing', { ...QUALITY, state: 'computing' as const, quality: null, detail: 'The checks are still running.' }, /still running/],
    ['unavailable', { state: 'unavailable' as const, quality: null, silenced: [], detail: `No export at https://${HOST}/api` }, /No export/],
    ['failed', { state: 'failed' as const, quality: null, silenced: [], detail: `failed with ${TOKEN}` }, /failed/],
  ])('is source_unavailable while the checks are %s, and says nothing about whether findings exist', async (_name, response, words) => {
    const env = await read('app.data_quality', {}, appCtxWith(allReaders({ quality: async () => response })));
    expect(env.status).toBe('source_unavailable');
    expect(env.next).toMatch(words);
    expect(env.next).toMatch(/says nothing about whether records exist/);
    expect(JSON.stringify(env)).not.toMatch(new RegExp(`${HOST}|${TOKEN}`));
  });

  it('reports a reader that throws as unavailable', async () => {
    const env = await read('app.data_quality', {}, appCtxWith(allReaders({ quality: async () => { throw new Error(`down at ${HOST}`); } })));
    expect(env.status).toBe('source_unavailable');
    expect(JSON.stringify(env)).not.toContain(HOST);
  });
});

describe('app.pipeline', () => {
  it('names each source with its kind, whether it is connected, when it last delivered and how much', async () => {
    const env = await read('app.pipeline');
    expectClean(env);
    const sources = data(env).sources as Record<string, any>[];
    expect(sources.map(s => s.name)).toEqual(['Health Auto Export', 'Oura Ring', 'Hevy', 'Lab reports']);
    expect(sources.map(s => s.kind)).toEqual(['health', 'health', 'workout detail', 'documents']);
    expect(sources[0]).toMatchObject({ connected: true, lastRead: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/), display: { records: '120,000 observations' } });
    expect(sources[2]).toMatchObject({ connected: true, display: { records: '88 sessions' } });
    expect(sources[3]).toMatchObject({ connected: true, display: { records: '32 results in 2 documents' } });
  });

  it('gives each stage as ok or failed with a fixed reason, never the probe\'s own words', async () => {
    const stages = data(await read('app.pipeline')).stages as Record<string, any>[];
    expect(stages.find(s => s.name === 'Health Auto Export')).toMatchObject({ ok: false, reason: 'The source did not answer in time.' });
    expect(stages.find(s => s.name === 'Oura Ring')).toMatchObject({ ok: true });
    expect(stages.every(s => typeof s.ok === 'boolean' && typeof s.reason === 'string')).toBe(true);
  });

  it('carries no host, URL, key, probe body, raw error or path', async () => {
    const text = JSON.stringify(await read('app.pipeline'));
    for (const secret of [HOST, TOKEN, 'https://', 'api.hevy', 'bearer', 'canary', 'GET /', 'postgres']) expect(text).not.toContain(secret);
    for (const key of ['url', 'host', 'probe', 'config', 'derivedFrom', 'detail', 'path']) expect(text).not.toContain(`"${key}"`);
  });

  it('marks a source that is not connected', async () => {
    const report = { ...PIPELINE, stages: PIPELINE.stages.map(s => (s.id === 'oura_api' ? { ...s, status: 'unconfigured' as const } : s)), workoutSources: PIPELINE.workoutSources.map(s => ({ ...s, configured: false, sessions: 0, lastSyncAt: null })) };
    const sources = data(await read('app.pipeline', {}, appCtxWith(allReaders({ pipeline: async () => report })))).sources as Record<string, any>[];
    expect(sources.find(s => s.name === 'Oura Ring')).toMatchObject({ connected: false });
    expect(sources.find(s => s.name === 'Oura Ring')).not.toHaveProperty('lastRead');
    expect(sources.find(s => s.name === 'Hevy')).toMatchObject({ connected: false });
  });

  it('is unavailable when the report cannot be built, and leaves the lab source out when it cannot be read', async () => {
    const boom = await read('app.pipeline', {}, appCtxWith(allReaders({ pipeline: async () => { throw new Error(`down at ${HOST} ${TOKEN}`); } })));
    expect(boom.status).toBe('source_unavailable');
    expect(JSON.stringify(boom)).not.toMatch(new RegExp(`${HOST}|${TOKEN}`));
    const noLabs = await read('app.pipeline', {}, appCtxWith({ ...allReaders(), labReports: async () => { throw new Error(HOST); } }));
    expect(noLabs.status).toBe('ok');
    expect((data(noLabs).sources as { name: string }[]).map(s => s.name)).not.toContain('Lab reports');
  });
});
