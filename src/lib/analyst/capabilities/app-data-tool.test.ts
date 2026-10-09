// ── get_app_data: the tool ──────────────────────────────────────────────────
//
// The dispatch: a capability from the registry's enum, its params checked against
// its own schema, an unknown name answered with the list, errors only where the
// design says they are.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { createDataAccess } from '../dataAccess';
import { runTool } from '../tools';
import { CAPABILITIES } from './registry';
import { buildDataToolsPrompt } from '../systemPrompt';
import { toolSpecs } from '../tools';
import { DATA_TOOLS } from '../tools/data';
import { healthyReaders, installBodyDataset } from './app.fake';
import { allReaders } from './app-state.fake';
import { appCtxWith } from './app-ctx.fake';
import { CAPABILITY_MANIFEST } from './manifest';
import { expectClean } from './test-context.fake';
import { DEMO } from './test-context.fake';
import { REF } from './test-dataset.fake';

beforeEach(() => void installBodyDataset());
afterEach(() => resetToDemoDataset());

const capabilityByIdOrThrow = (id: string) => {
  const cap = CAPABILITIES.find(c => c.id === id);
  if (!cap) throw new Error(`no capability ${id}`);
  return cap;
};
const sampleParams = (id: string): Record<string, unknown> => (id === 'insights.reports' ? { kind: 'weekly', count: 2 } : {});

describe('get_app_data, the tool', () => {
  const toolCtx = (readers = healthyReaders()) => ({
    system: 'metric' as const,
    deps: { env: DEMO },
    changes: [],
    data: createDataAccess({ system: 'metric', refKey: REF, env: DEMO, app: readers }),
  });
  const call = async (args: Record<string, unknown>, ctx = toolCtx()) => {
    const r = await runTool('get_app_data', args, ctx);
    return { ...r, json: JSON.parse(r.content) };
  };

  it('reads the capability it is given, through the same read', async () => {
    const r = await call({ capability: 'body.goal' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ status: 'ok', capability: 'body.goal' });
  });

  it('checks params against that capability\'s own schema', async () => {
    const bad = await call({ capability: 'insights.reports', params: { kind: 'weekly', count: 13 } });
    expect(bad.isError).toBe(true);
    expect(bad.json.problems.join(' ')).toMatch(/params\.count must be at most 12/);
    expect((await call({ capability: 'body.goal', params: { window: { lastDays: 3 } } })).json.problems.join(' ')).toMatch(/not an accepted argument/);
    expect((await call({ capability: 'insights.reports', params: { kind: 'weekly', count: 2 } })).isError).toBe(false);
  });

  it('answers an unknown capability with invalid_args naming every one it has', async () => {
    const r = await call({ capability: 'body.mood' });
    expect(r.isError).toBe(true);
    const text = JSON.stringify(r.json);
    for (const e of CAPABILITY_MANIFEST.filter(e => e.tool === 'get_app_data')) expect(text).toContain(e.id);
  });

  it('is an error for an unavailable store and not for an empty answer', async () => {
    expect((await call({ capability: 'labs.documents' }, toolCtx(healthyReaders({ labReports: async () => null })))).isError).toBe(true);
    const none = await call({ capability: 'body.goal' }, toolCtx(healthyReaders({ goalSummary: async () => null })));
    expect(none.isError).toBe(false);
    expect(none.json.status).toBe('no_data_in_window');
  });
});
describe('get_app_data, all its capabilities', () => {
  const ids = CAPABILITY_MANIFEST.filter(e => e.tool === 'get_app_data').map(e => e.id);
  const SOURCE = /health auto export|\boura\b|\bhevy\b/i;

  it('are the fourteen of the design, and the tool\'s enum is exactly them', () => {
    expect(ids).toHaveLength(14);
    expect(ids).toEqual(expect.arrayContaining(['labs.documents', 'body.goal', 'body.nutrition_adherence', 'insights.current', 'insights.reports', 'activity.coverage', 'activity.maps', 'app.data_quality', 'app.pipeline', 'app.profile', 'app.preferences', 'app.briefing', 'app.dashboard', 'training.workout_template']));
    const spec = toolSpecs(DATA_TOOLS).find(s => s.name === 'get_app_data')!;
    expect((spec.parameters as { properties: { capability: { enum: string[] } } }).properties.capability.enum).toEqual(ids);
    expect(CAPABILITIES.filter(c => c.tool === 'get_app_data').map(c => c.id)).toEqual(ids);
  });

  it.each(ids.filter(id => id !== 'training.workout_template'))('%s obeys the number rule, and names no data source unless it is app.pipeline', async id => {
    const env = await capabilityByIdOrThrow(id).read(sampleParams(id), appCtxWith(allReaders()));
    expectClean(env);
    const text = JSON.stringify(env);
    if (id === 'app.pipeline') expect(text).toMatch(SOURCE);
    else expect(text).not.toMatch(SOURCE);
  });

  it('keeps the data tool specs within 12,000 characters together, get_app_data included', () => {
    expect(JSON.stringify(toolSpecs(DATA_TOOLS)).length).toBeLessThanOrEqual(12_000);
  });

  it('tells the model to name a source only when the question is about sources', () => {
    expect(buildDataToolsPrompt('')).toContain('Name a data source only when the question is about sources or connections.');
  });
});
