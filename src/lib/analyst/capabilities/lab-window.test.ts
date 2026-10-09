// ── get_lab_results with a window ───────────────────────────────────────────
//
// The window filters observations by the day they were measured. A series with
// nothing measured in it is named in notInWindow: never silently dropped, and never
// the same as "this analyte was not found".

import { describe, expect, it } from 'vitest';
import { createDataAccess } from '../dataAccess';
import { runTool, type ToolContext } from '../tools';
import { DEMO } from './test-context.fake';
import { DATED_LABS } from './lab.fake';
import type { LabSourceInput } from '../labSnapshot';

function ctxFor(source: LabSourceInput = DATED_LABS): ToolContext {
  const data = createDataAccess({ system: 'metric', refKey: '2026-10-08', env: DEMO, labSource: async () => source });
  return { system: 'metric', deps: { env: DEMO }, changes: [], data };
}

type Result = { name: string; latestOn?: string; latest?: string; history?: unknown; seriesKey: string }[];
async function call(args: Record<string, unknown>, ctx = ctxFor()) {
  const out = await runTool('get_lab_results', args, ctx);
  return { ...out, json: JSON.parse(out.content) as { results?: Result; notInWindow?: string[]; window?: Record<string, string>; error?: string; notFound?: string[] } };
}
const ALL = ['ldl', 'hemoglobin', 'alt'];

describe('get_lab_results window', () => {
  it('returns only the observations measured in the window, and the latest is the latest in it', async () => {
    const r = await call({ analytes: ['ldl'], window: { month: '2026-06' } });
    expect(r.isError).toBe(false);
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results![0]).toMatchObject({ seriesKey: 'ldl', latestOn: '2026-06-15' });
    expect(r.json.window).toMatchObject({ start: '2026-06-01', end: '2026-06-30', asked: 'month 2026-06' });
  });

  it('lists a requested series with nothing in the window in notInWindow, by name', async () => {
    const r = await call({ analytes: ALL, window: { start: '2026-09-01', end: '2026-10-08' } });
    expect(r.json.results!.map(x => x.seriesKey).sort()).toEqual(['alt', 'ldl']);
    expect(r.json.notInWindow).toEqual(['Hemoglobin']);
    expect(r.json.notFound).toBeUndefined();
  });

  it('lists every requested series in notInWindow when the window holds none, and is not an error', async () => {
    const r = await call({ analytes: ALL, window: { day: '2026-01-05' } });
    expect(r.isError).toBe(false);
    expect(r.json.results).toEqual([]);
    expect([...r.json.notInWindow!].sort()).toEqual(['ALT', 'Hemoglobin', 'LDL cholesterol']);
  });

  it('applies to a category, and keeps a missing category an error', async () => {
    const r = await call({ category: 'CBC', window: { month: '2026-09' } });
    expect(r.json.results).toEqual([]);
    expect(r.json.notInWindow).toEqual(['Hemoglobin']);
    expect((await call({ category: 'Nope', window: { month: '2026-09' } })).isError).toBe(true);
  });

  it('keeps the history inside the window', async () => {
    const r = await call({ analytes: ['ldl'], history: true, window: { start: '2026-03-01', end: '2026-07-01' } });
    const text = JSON.stringify(r.json.results);
    expect(text).toContain('2026-03-10');
    expect(text).toContain('2026-06-15');
    expect(text).not.toContain('2026-09-29');
  });

  it('judges flaggedOnly by the latest result in the window', async () => {
    // LDL was high on 29 Sep; in June it was in range.
    const inSeptember = await call({ flaggedOnly: true, window: { month: '2026-09' } });
    expect(inSeptember.json.results!.map(x => x.seriesKey)).toEqual(['ldl']);
    const inJune = await call({ flaggedOnly: true, window: { month: '2026-06' } });
    expect(inJune.json.results).toEqual([]);
  });

  it('changes nothing without a window', async () => {
    const r = await call({ analytes: ALL });
    expect(r.json.results!.map(x => x.seriesKey).sort()).toEqual(['alt', 'hemoglobin', 'ldl']);
    expect(r.json.notInWindow).toBeUndefined();
    expect(r.json.window).toBeUndefined();
    expect(r.json.results!.find(x => x.seriesKey === 'ldl')!.latestOn).toBe('2026-09-29');
  });

  it('refuses a bad or future window with the problem named', async () => {
    const bad = await call({ analytes: ['ldl'], window: { month: '2026-13' } });
    expect(bad.isError).toBe(true);
    expect(bad.json.error).toMatch(/month must be YYYY-MM/);
    const future = await call({ analytes: ['ldl'], window: { day: '2027-01-01' } });
    expect(future.json.error).toMatch(/after today/);
  });

  it('records only what it returned, so the answer can cite no more than the window held', async () => {
    const ctx = ctxFor();
    await call({ analytes: ['ldl'], window: { month: '2026-06' } }, ctx);
    const kept = ctx.data!.fetched.labSeries.get('ldl')!;
    expect(kept.shownPoints).toBe(1);
  });
});
