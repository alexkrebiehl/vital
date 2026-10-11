// ── The tools over the metric capabilities ──────────────────────────────────
//
// get_metric_series through the tool loop's own runTool (schema check, JSON, the
// error flag), and the window the relationship tool now takes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { availableTools, runTool } from '../tools';
import { DATA_TOOL_NAMES } from '../tools/names';
import { installTestDataset, REF } from './test-dataset.fake';
import { testCtx } from './test-context.fake';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

function toolCtx() {
  const c = testCtx();
  return { system: 'metric' as const, deps: c.routine, changes: [], data: c.access };
}
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await runTool(name, args, toolCtx());
  return { ...r, json: JSON.parse(r.content) };
};

describe('get_metric_series', () => {
  it('is offered, and is a data tool', () => {
    expect(availableTools({ data: toolCtx().data }).map(t => t.name)).toContain('get_metric_series');
    expect(DATA_TOOL_NAMES).toContain('get_metric_series');
  });

  it('returns the envelope as JSON, not an error', async () => {
    const r = await call('get_metric_series', { metrics: ['resting_heart_rate'], window: { lastDays: 7 } });
    expect(r.isError).toBe(false);
    expect(r.json.status).toBe('ok');
    expect(r.json.data.metrics[0].points).toHaveLength(7);
  });

  it('rejects more than three metrics and an unknown window field before reading', async () => {
    const many = await call('get_metric_series', { metrics: ['a', 'b', 'c', 'd'] });
    expect(many.isError).toBe(true);
    expect(many.json.problems.join(' ')).toMatch(/at most 3 items/);
    const bad = await call('get_metric_series', { metrics: ['step_count'], window: { week: 3 } });
    expect(bad.isError).toBe(true);
  });

  it('flags an invalid_args envelope as an error and an empty window as an answer', async () => {
    expect((await call('get_metric_series', { metrics: ['blood_pressure'] })).isError).toBe(true);
    const empty = await call('get_metric_series', { metrics: ['resting_heart_rate'], window: { start: '2020-01-01', end: '2020-01-31' } });
    expect(empty.isError).toBe(false);
    expect(empty.json.status).toBe('no_data_in_window');
  });

  it('replaced get_metrics and compare_periods: they are gone, with no alias', async () => {
    const offered = availableTools({ data: testCtx().access }).map(t => t.name);
    expect(offered).not.toContain('get_metrics');
    expect(offered).not.toContain('compare_periods');
    expect(DATA_TOOL_NAMES).not.toContain('get_metrics');
    expect(DATA_TOOL_NAMES).not.toContain('compare_periods');
    for (const name of ['get_metrics', 'compare_periods']) {
      const r = await call(name, { metrics: ['resting_heart_rate'] });
      expect(r.isError).toBe(true);
      expect(r.json.error).toMatch(new RegExp(`There is no tool "${name}"`));
    }
  });

  it('carries the figures an answer may quote as display strings', async () => {
    const r = await call('get_metric_series', { metrics: ['resting_heart_rate'] });
    expect(r.json.data.metrics[0].summary.mean).toMatch(/^[\d.]+ bpm$/);
  });
});

describe('get_metric_relationship window', () => {
  it('defaults to the last 90 days', async () => {
    const r = await call('get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate' });
    expect(r.isError).toBe(false);
    expect(r.json.window).toEqual({ start: addDays(REF, -89), end: REF });
  });

  it('takes any window', async () => {
    const r = await call('get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate', window: { month: '2026-03' } });
    expect(r.json.window).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    expect(r.json.pairedDays).toBe(31);
  });

  it('keeps days as the alias of lastDays', async () => {
    const r = await call('get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate', days: 30 });
    expect(r.json.window).toEqual({ start: addDays(REF, -29), end: REF });
  });

  it('refuses both, and an impossible window, with the problem', async () => {
    const both = await call('get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate', days: 30, window: { lastDays: 7 } });
    expect(both.isError).toBe(true);
    const bad = await call('get_metric_relationship', { x: 'heart_rate_variability', y: 'resting_heart_rate', window: { day: '2026-02-30' } });
    expect(bad.json.error).toMatch(/not a real calendar day/);
  });
});
