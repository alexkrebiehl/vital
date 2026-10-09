// ── Live state: a removed source is gone on the next question ───────────────
//
// Design §9.1: no module-level cache in capabilities/. A read looks at the dataset
// the route installed for this question, and the one memo (the lab source) lives on
// the question's DataAccess. Removing a source purges its records (installDataset
// does it before building); the next question must see none of them.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset, setActiveDataset } from '../../adapters/dataset';
import type { HealthFixtures } from '../../metrics/types';
import { createDataAccess } from '../dataAccess';
import type { LabSourceInput } from '../labSnapshot';
import { runTool } from '../tools';
import { DATED_LABS } from './lab.fake';
import { capabilityById } from './registry';
import { DEMO } from './test-context.fake';
import { installTestDataset, REF, trainingData } from './test-dataset.fake';
import { ALLOW_ALL, type CapabilityContext } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

/** A new DataAccess, as the next question builds. */
function question(lab: () => Promise<LabSourceInput> = async () => DATED_LABS) {
  const access = createDataAccess({ system: 'metric', refKey: REF, env: DEMO, labSource: lab, training: async () => trainingData([]) });
  const ctx: CapabilityContext = { system: 'metric', refKey: REF, tz: 'America/Chicago', env: DEMO, access, routine: { env: DEMO }, policy: ALLOW_ALL };
  return { access, ctx, tool: async (name: string, args: Record<string, unknown>) => JSON.parse((await runTool(name, args, { system: 'metric', deps: ctx.routine, changes: [], data: access })).content) };
}

/** What installDataset leaves after the purge of a removed source: no record that source supplied. */
function without(data: HealthFixtures, source: string): HealthFixtures {
  const metrics = Object.fromEntries(Object.entries(data.metrics).map(([id, series]) => [id, (series as { source?: string }[]).filter(o => o.source !== source)])) as HealthFixtures['metrics'];
  return { ...data, metrics, workouts: data.workouts.filter(w => w.source !== source), coverage: {} };
}

describe('removing a source between two questions', () => {
  it('shows get_workouts the installed workouts, then none of them once their source is purged', async () => {
    const data = installTestDataset();
    const before = question();
    const seen = await before.tool('get_workouts', { window: { lastDays: 30 } });
    expect(seen.status).toBe('ok');
    expect(seen.page.total).toBeGreaterThan(0);
    const held = await capabilityById('workouts.sessions')!.coverage(before.ctx);
    expect(held).toMatchObject({ kind: 'known', count: data.workouts.length });

    setActiveDataset(without(data, 'test'), { mode: 'demo' });

    const after = question();
    const gone = await after.tool('get_workouts', { window: { lastDays: 30 } });
    expect(gone.status).toBe('no_data_in_window');
    expect(gone.data).toBeUndefined();
    expect(JSON.stringify(gone)).not.toMatch(/w-0001|Running|Cycling/);
    expect(await capabilityById('workouts.sessions')!.coverage(after.ctx)).toMatchObject({ kind: 'known', count: 0 });
    expect(await capabilityById('workouts.summary')!.coverage(after.ctx)).toMatchObject({ kind: 'known', count: 0 });
  });

  it('shows the metric series and their coverage nothing of the purged source', async () => {
    const data = installTestDataset();
    expect((await question().tool('get_metric_series', { metrics: ['resting_heart_rate'], window: { lastDays: 30 } })).status).toBe('ok');
    setActiveDataset(without(data, 'test'), { mode: 'demo' });
    const after = question();
    expect((await after.tool('get_metric_series', { metrics: ['resting_heart_rate'], window: { lastDays: 30 } })).status).not.toBe('ok');
    const sleep = await after.tool('get_sleep', { window: { lastDays: 14 } });
    expect(sleep.status).toBe('no_data_in_window');
    const coverage = await capabilityById('metrics.summary')!.coverage(after.ctx);
    expect(coverage.kind === 'known' && coverage.count).toBe(0);
  });
});

describe('the lab source is remembered for one question only', () => {
  it('is read once for a question and again, fresh, for the next', async () => {
    let calls = 0;
    let held: LabSourceInput = DATED_LABS;
    const reader = async () => (calls++, held);

    const first = question(reader);
    await first.tool('get_lab_results', { analytes: ['ldl'] });
    await first.tool('get_lab_results', { analytes: ['alt'] });
    expect(calls).toBe(1);

    // The documents are deleted; the next question reads the store again.
    held = { ...DATED_LABS, totalObservations: 0, series: [] };
    const second = question(reader);
    const gone = await second.tool('get_lab_results', { analytes: ['ldl'] });
    expect(calls).toBe(2);
    expect(gone.results).toEqual([]);
    expect(gone.notFound).toEqual(['ldl']);
    expect(await capabilityById('labs.series')!.coverage(second.ctx)).toMatchObject({ kind: 'known', count: 0 });
  });
});

describe('capabilities/ keeps no module-level mutable state', () => {
  const DIR = __dirname;
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const sources = files(DIR).filter(f => f.endsWith('.ts') && !/\.(test|fake|canaries)\.ts$/.test(f));

  // A top-level `let` or `var`, or a Map or Set built where nothing wraps it.
  const state = (text: string): string[] =>
    text
      .split('\n')
      .filter(l => !l.startsWith('//') && !l.startsWith(' *') && !l.startsWith('/*'))
      .filter(l => /^(export\s+)?(let|var)\s/.test(l) || /^(export\s+)?const\s[^=]*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/.test(l) || /^\S.*\bnew\s+(Map|Set|WeakMap|WeakSet)\s*[<(]/.test(l));

  it('scans the registry, the areas and the reads', () => {
    const names = sources.map(f => path.relative(DIR, f));
    expect(names).toEqual(expect.arrayContaining(['registry.ts', 'envelope.ts', 'areas/medications.ts', 'reads/workouts-sessions.ts']));
  });

  it.each(sources.map(f => [path.relative(DIR, f), fs.readFileSync(f, 'utf8')]))('%s holds nothing between questions', (_name, text) => {
    expect(state(text)).toEqual([]);
  });

  it('would catch each kind of state (the scanner itself)', () => {
    expect(state('let cached = null;')).toHaveLength(1);
    expect(state('var memo;')).toHaveLength(1);
    expect(state('const BY_ID = new Map<string, number>(')).toHaveLength(1);
    expect(state('export const SEEN = new Set([])')).toHaveLength(1);
    expect(state('  const local = new Map();')).toEqual([]);
    expect(state('// let x = new Map();')).toEqual([]);
  });
});
