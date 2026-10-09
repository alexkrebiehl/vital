// ── The record tools through the tool loop's runTool ────────────────────────
//
// get_workouts, get_sleep and get_blood_pressure as the model calls them: the
// schema check, the dispatch between views, the legacy `days`, and the error flag.
// Plus a sweep of every capability result against the number rule and the
// source-name rule, and the size of the tool specs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { availableTools, runTool, toolSpecs } from '../tools';
import { DATA_TOOLS, MAX_DATA_RESULT_CHARS } from '../tools/data';
import { DATA_TOOL_NAMES } from '../tools/names';
import { assertNumberRule } from './number-rule';
import { installTestDataset, REF, strengthSessions, trainingData } from './test-dataset.fake';
import { testCtx } from './test-context.fake';

let data: ReturnType<typeof installTestDataset>;
beforeEach(() => void (data = installTestDataset()));
afterEach(() => resetToDemoDataset());

function toolCtx(withStrength = false) {
  const c = testCtx({}, async () => trainingData(withStrength ? strengthSessions(data) : []));
  return { system: 'metric' as const, deps: c.routine, changes: [], data: c.access };
}
const call = async (name: string, args: Record<string, unknown>, ctx = toolCtx()) => {
  const r = await runTool(name, args, ctx);
  return { ...r, json: JSON.parse(r.content) };
};

describe('the record tools are data tools, offered with the others', () => {
  it('names them, and offers them whenever the question has data readers', () => {
    for (const name of ['get_workouts', 'get_sleep', 'get_blood_pressure']) {
      expect(DATA_TOOL_NAMES).toContain(name);
      expect(availableTools({ data: toolCtx().data }).map(t => t.name)).toContain(name);
      expect(availableTools({}).map(t => t.name)).not.toContain(name);
    }
  });

  it('keeps the specs of the data tools within 12,000 characters together', () => {
    const size = JSON.stringify(toolSpecs(DATA_TOOLS)).length;
    expect(size).toBeLessThanOrEqual(12_000);
  });
});

describe('get_workouts', () => {
  it('lists sessions by default and the summary under view: summary', async () => {
    const a = await call('get_workouts', { window: { lastDays: 30 } });
    expect(a.isError).toBe(false);
    expect(a.json.data.sessions).toHaveLength(20);
    const b = await call('get_workouts', { view: 'summary', days: 30 });
    expect(b.json.data.totals.sessions).toBe(a.json.page.total);
    expect(b.json.data.rollup.sessions).toBe(a.json.page.total);
  });

  it('keeps days as the alias of window.lastDays', async () => {
    const r = await call('get_workouts', { days: 7 });
    expect(r.json.window).toMatchObject({ start: addDays(REF, -6), end: REF, asked: 'lastDays 7' });
  });

  it('joins strength detail when asked', async () => {
    const r = await call('get_workouts', { type: 'strength training', detail: true, window: { lastDays: 400 }, limit: 6 }, toolCtx(true));
    expect(r.json.data.sessions.some((s: { strength?: unknown }) => s.strength)).toBe(true);
  });

  it.each([
    [{ limit: 26 }, /at most 25/],
    [{ sort: 'name' }, /one of: date, duration, calories, distance/],
    [{ view: 'table' }, /one of: sessions, summary/],
    [{ window: { week: 3 } }, /not an accepted argument/],
    [{ days: 0 }, /at least 1/],
    [{ detail: 'yes' }, /true or false/],
  ])('rejects %j before reading', async (args, problem) => {
    const r = await call('get_workouts', args);
    expect(r.isError).toBe(true);
    expect(r.json.problems.join(' ')).toMatch(problem);
  });

  it('answers a wrong type with the types that exist, as an error the model can fix', async () => {
    const r = await call('get_workouts', { type: 'Rowing', window: { lastDays: 400 } });
    expect(r.isError).toBe(true);
    expect(r.json.status).toBe('invalid_args');
    expect(r.json.data.typesInWindow.length).toBe(5);
  });

  it('answers an empty window as an answer, not an error', async () => {
    const r = await call('get_workouts', { window: { start: '2020-01-01', end: '2020-01-31' } });
    expect(r.isError).toBe(false);
    expect(r.json.status).toBe('no_data_in_window');
    expect(r.json.next).toMatch(/The app holds 420 sessions from/);
  });
});

describe('get_sleep and get_blood_pressure', () => {
  it('return nights and readings, and their summaries', async () => {
    expect((await call('get_sleep', {})).json.data.nights).toHaveLength(14);
    expect((await call('get_sleep', { view: 'summary', window: { lastDays: 60 } })).json.data.byPeriod.length).toBeGreaterThan(0);
    expect((await call('get_blood_pressure', {})).json.data.readings.length).toBeGreaterThan(0);
    expect((await call('get_blood_pressure', { view: 'summary', window: { lastDays: 200 } })).json.data.referenceThreshold).toBe('120/80 mmHg');
  });

  it('rejects a limit past the maximum', async () => {
    expect((await call('get_sleep', { limit: 32 })).isError).toBe(true);
    expect((await call('get_blood_pressure', { limit: 101 })).isError).toBe(true);
  });

  it('flags a refused call as an error and an empty window as an answer', async () => {
    expect((await call('get_sleep', { sort: 'dream' })).isError).toBe(true);
    const empty = await call('get_blood_pressure', { window: { start: '2020-01-01', end: '2020-01-31' } });
    expect(empty.isError).toBe(false);
    expect(empty.json.status).toBe('no_data_in_window');
  });

  it('say so when the question has no data readers', async () => {
    const r = await runTool('get_sleep', {}, { system: 'metric', deps: { env: {} as NodeJS.ProcessEnv }, changes: [] });
    expect(r.isError).toBe(true);
  });
});

describe('every result obeys the number rule and names no data source', () => {
  const CALLS: [string, Record<string, unknown>][] = [
    ['get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate' }],
    ['get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate', lagDays: 2, window: { month: '2026-03' } }],
    ['get_metric_series', { metrics: ['resting_heart_rate'] }],
    ['get_metric_series', { metrics: ['step_count', 'heart_rate_variability'], window: { lastDays: 200 }, compareTo: 'none' }],
    ['get_metric_series', { metrics: ['sleep_analysis'], granularity: 'summary', window: { lastDays: 400 } }],
    ['get_workouts', {}],
    ['get_workouts', { window: { lastDays: 400 }, limit: 25, sort: 'distance' }],
    ['get_workouts', { view: 'summary', window: { lastDays: 400 } }],
    ['get_workouts', { view: 'summary', days: 30 }],
    ['get_sleep', {}],
    ['get_sleep', { window: { lastDays: 400 }, sort: 'deep', limit: 10 }],
    ['get_sleep', { window: { lastDays: 400 } }],
    ['get_blood_pressure', {}],
    ['get_blood_pressure', { window: { lastDays: 200 }, aboveReferenceOnly: true, limit: 100 }],
    ['get_blood_pressure', { view: 'summary', window: { lastDays: 40 } }],
  ];

  it.each(CALLS)('%s %j', async (name, args) => {
    const r = await call(name, args);
    expect(r.isError, r.content.slice(0, 200)).toBe(false);
    assertNumberRule(r.json);
    expect(r.content.length).toBeLessThanOrEqual(MAX_DATA_RESULT_CHARS);
    expect(r.content).not.toMatch(/hevy|health auto export|\bhae\b|oura|apple health/i);
  });

  it('holds for the specs the model reads too', () => {
    for (const t of DATA_TOOLS) expect(JSON.stringify(t), t.name).not.toMatch(/hevy|health auto export|\bhae\b|oura/i);
  });
});
