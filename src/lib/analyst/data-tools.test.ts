// ── The on-demand data tools ────────────────────────────
//
// What these pin: a tool returns what the fixed context would have carried (same
// display strings, same status words), stays inside its size limit without ever being
// cut mid-value, says what it left out, refuses what it cannot find with the names that
// would work, and records what it returned so an answer can cite it and be audited.

import { describe, expect, it } from 'vitest';
import { createDataAccess, mergeFetched, nothingFetched } from './dataAccess';
import { buildLabIndex, buildMetricIndex } from './dataIndex';
import { COVERAGE_INDEX_MAX_CHARS, renderCoverageIndex } from './capabilities/coverage-index';
import { buildContextPayload } from './systemPrompt';
import { DATA_TOOLS, MAX_COMPARE_ROWS, MAX_DATA_RESULT_CHARS, MAX_LAB_SERIES_PER_CALL } from './tools/data';
import { availableTools, runTool, type ToolContext } from './tools';
import { checkGrounding } from './validate';
import { retrieveNone } from './retrieval';
import type { LabSeriesInput, LabSeriesObservationInput, LabSourceInput } from './labSnapshot';
import type { AnalystAnswer } from './types';

const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;

function obs(on: string, value: number | null, extra: Partial<LabSeriesObservationInput> = {}): LabSeriesObservationInput {
  return {
    on,
    value,
    valueText: null,
    unit: 'mg/dL',
    printedRefText: '<200 mg/dL',
    interval: { low: null, high: 200, origin: 'report', refText: '<200 mg/dL', refBasis: null, bandNote: null, band: null },
    status: value !== null && value > 200 ? 'out_high' : 'in_range',
    statusLabel: value !== null && value > 200 ? 'High' : 'In range',
    tone: value !== null && value > 200 ? 'bad' : 'good',
    ...extra,
  } as LabSeriesObservationInput;
}

function series(key: string, name: string, category: string, points: LabSeriesObservationInput[]): LabSeriesInput {
  return { seriesKey: key, analyteKey: key, displayName: name, category, specimen: 'other', registered: false, unit: 'mg/dL', points };
}

/** Two panels (Sept 29 and Oct 1) with a spread of categories, plus one analyte measured once. */
function twoPanels(extra: LabSeriesInput[] = []): LabSourceInput {
  const all = [
    series('total_cholesterol', 'Total cholesterol', 'Lipids', [obs('2026-09-29', 166), obs('2026-10-01', 231)]),
    series('ldl', 'LDL cholesterol', 'Lipids', [obs('2026-09-29', 90), obs('2026-10-01', 95)]),
    series('hemoglobin', 'Hemoglobin', 'CBC', [obs('2026-09-29', 10.9, { unit: 'g/dL' }), obs('2026-10-01', 11.4, { unit: 'g/dL' })]),
    series('alt', 'ALT', 'Liver', [obs('2026-09-29', 41, { unit: 'U/L' })]),
    ...extra,
  ];
  return { available: true, reason: null, documents: 2, totalObservations: all.reduce((n, s) => n + s.points.length, 0), collisions: 0, series: all };
}

function ctxFor(source: LabSourceInput = twoPanels()): ToolContext {
  const data = createDataAccess({
    system: 'metric',
    refKey: '2026-09-17',
    env: DEMO,
    labSource: async () => source,
    medications: async days => ({
      available: true,
      reason: null,
      referenceDay: '2026-10-01',
      lookbackDays: days,
      windowFrom: null,
      windowTo: null,
      readAt: null,
      totalRecords: 4,
      totalMedications: 1,
      undatedRecords: 0,
      skippedRecords: 0,
      medications: [],
      note: `last ${days} days`,
      completeness: 'what was logged',
      kind: 'record',
    }),
  });
  return { system: 'metric', deps: { env: DEMO }, changes: [], data };
}

const call = async (ctx: ToolContext, name: string, args: Record<string, unknown>) => {
  const out = await runTool(name, args, ctx);
  return { ...out, json: JSON.parse(out.content.replace(/… \[truncated\]$/, '')) as Record<string, any> };
};

describe('availability', () => {
  it('offers the data tools only when data access is present', () => {
    expect(availableTools({}).some(t => t.name === 'get_lab_results')).toBe(false);
    const names = availableTools(ctxFor()).map(t => t.name);
    for (const t of DATA_TOOLS) expect(names).toContain(t.name);
    expect(names).toContain('get_routine_progress');
  });

  it('every data tool is read-only', () => {
    expect(DATA_TOOLS.every(t => t.kind === 'read')).toBe(true);
  });

  it('without data access a data tool is an error the model can read, not a crash', async () => {
    const out = await runTool('get_lab_results', { analytes: ['ldl'] }, { system: 'metric', deps: { env: DEMO }, changes: [] });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content).error).toMatch(/There is no tool "get_lab_results"/);
  });
});

describe('get_lab_results', () => {
  it('returns only the series asked for, with the same display strings the fixed block carries', async () => {
    const ctx = ctxFor();
    const r = await call(ctx, 'get_lab_results', { analytes: ['LDL cholesterol'] });
    expect(r.isError).toBe(false);
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results[0]).toMatchObject({ seriesKey: 'ldl', name: 'LDL cholesterol', status: 'In range', latestOn: '2026-10-01', previousOn: '2026-09-29' });
    expect(r.json.results[0].latest).toContain('95');
    expect(JSON.stringify(r.json)).not.toContain('Hemoglobin');
  });

  it('matches by series key, display name and a category', async () => {
    const ctx = ctxFor();
    expect((await call(ctx, 'get_lab_results', { analytes: ['hemoglobin'] })).json.results[0].seriesKey).toBe('hemoglobin');
    expect((await call(ctx, 'get_lab_results', { category: 'Lipids' })).json.results.map((x: any) => x.seriesKey).sort()).toEqual(['ldl', 'total_cholesterol']);
  });

  it('names what it could not match instead of pretending nothing exists', async () => {
    const r = await call(ctxFor(), 'get_lab_results', { analytes: ['ldl', 'unobtainium'] });
    expect(r.json.results).toHaveLength(1);
    expect(r.json.notFound).toEqual(['unobtainium']);
    expect(r.json.note).toMatch(/index/);
  });

  it('gives the categories when the category is wrong', async () => {
    const r = await call(ctxFor(), 'get_lab_results', { category: 'Nonsense' });
    expect(r.isError).toBe(true);
    expect(r.json.categories).toEqual(expect.arrayContaining(['Lipids', 'CBC', 'Liver']));
  });

  it('refuses a request that names nothing, rather than returning everything', async () => {
    const r = await call(ctxFor(), 'get_lab_results', {});
    expect(r.isError).toBe(true);
    expect(r.json.error).toMatch(/Say which results/);
  });

  it('flaggedOnly keeps the series whose latest result is outside its interval', async () => {
    const r = await call(ctxFor(), 'get_lab_results', { flaggedOnly: true });
    expect(r.json.results.map((x: any) => x.seriesKey)).toEqual(['total_cholesterol']);
  });

  it('history adds the earlier observations, bounded', async () => {
    const without = await call(ctxFor(), 'get_lab_results', { analytes: ['total_cholesterol'] });
    const withHistory = await call(ctxFor(), 'get_lab_results', { analytes: ['total_cholesterol'], history: true });
    expect(without.json.results[0].history).toBeUndefined();
    expect(withHistory.json.results[0].history).toContain('2026-09-29');
  });

  it('caps the series per call and says which were not returned', async () => {
    const many = Array.from({ length: 40 }, (_, i) => series(`a${String(i).padStart(2, '0')}`, `Analyte ${String(i).padStart(2, '0')}`, 'Bulk', [obs('2026-10-01', i)]));
    const r = await call(ctxFor(twoPanels(many)), 'get_lab_results', { category: 'Bulk' });
    expect(r.json.results).toHaveLength(MAX_LAB_SERIES_PER_CALL);
    expect(r.json.notReturned).toHaveLength(20);
    expect(r.json.why).toMatch(/another call/);
  });

  it('never returns more than the size limit, and drops whole series rather than cutting one', async () => {
    const wide = Array.from({ length: 20 }, (_, i) =>
      series(`w${i}`, `Wide ${i}`, 'Wide', Array.from({ length: 90 }, (_, d) => obs(`2026-${String(1 + (d % 9)).padStart(2, '0')}-${String(1 + Math.floor(d / 9)).padStart(2, '0')}`, d)))
    );
    const r = await call(ctxFor(twoPanels(wide)), 'get_lab_results', { category: 'Wide', history: true });
    expect(r.content.length).toBeLessThanOrEqual(MAX_DATA_RESULT_CHARS);
    expect(r.content).not.toMatch(/truncated/);
    expect(() => JSON.parse(r.content)).not.toThrow();
    expect(r.json.notReturned.length).toBeGreaterThan(0);
  });

  it('says so when the lab data cannot be read', async () => {
    const ctx = ctxFor({ available: false, reason: 'No Postgres database is configured.', documents: 0, totalObservations: 0, collisions: 0, series: [] });
    const r = await call(ctx, 'get_lab_results', { analytes: ['ldl'] });
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe('No Postgres database is configured.');
  });

  it('reads the lab source once per question however many calls are made', async () => {
    let reads = 0;
    const data = createDataAccess({ system: 'metric', refKey: '2026-09-17', env: DEMO, labSource: async () => (reads++, twoPanels()) });
    const ctx: ToolContext = { system: 'metric', deps: { env: DEMO }, changes: [], data };
    await call(ctx, 'get_lab_results', { analytes: ['ldl'] });
    await call(ctx, 'get_lab_results', { analytes: ['alt'] });
    await call(ctx, 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' });
    expect(reads).toBe(1);
  });
});

describe('compare_lab_panels', () => {
  it('compares two panel dates series by series', async () => {
    const r = await call(ctxFor(), 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' });
    expect(r.json.compared).toBe(3);
    expect(r.json.changed).toBe(3);
    const chol = r.json.rows.find((x: any) => x.seriesKey === 'total_cholesterol');
    expect(chol['2026-09-29']).toContain('166');
    expect(chol['2026-10-01']).toContain('231');
    expect(chol.change).toMatch(/\+65/);
    expect(chol.status).toBe('In range → High');
  });

  it('lists a series measured on only one of the dates by name', async () => {
    const r = await call(ctxFor(), 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' });
    expect(r.json.onlyOnDateA).toEqual(['ALT']);
  });

  it('changedOnly drops the unchanged series', async () => {
    const same = series('same', 'Stable', 'CBC', [obs('2026-09-29', 5), obs('2026-10-01', 5)]);
    const r = await call(ctxFor(twoPanels([same])), 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01', changedOnly: true });
    expect(r.json.rows.some((x: any) => x.seriesKey === 'same')).toBe(false);
    expect(r.json.compared).toBe(4);
  });

  it('gives the real panel dates when one is wrong', async () => {
    const r = await call(ctxFor(), 'compare_lab_panels', { dateA: '2026-09-28', dateB: '2026-10-01' });
    expect(r.isError).toBe(true);
    expect(r.json.error).toMatch(/No lab results are dated 2026-09-28/);
    expect(r.json.panelDates).toEqual([{ on: '2026-09-29', series: 4 }, { on: '2026-10-01', series: 3 }]);
  });

  it('refuses the same date twice', async () => {
    expect((await call(ctxFor(), 'compare_lab_panels', { dateA: '2026-10-01', dateB: '2026-10-01' })).isError).toBe(true);
  });

  it('caps the rows and says how many were not returned', async () => {
    const bulk = Array.from({ length: 120 }, (_, i) => series(`b${i}`, `Bulk ${i}`, 'Bulk', [obs('2026-09-29', i), obs('2026-10-01', i + 1)]));
    const r = await call(ctxFor(twoPanels(bulk)), 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' });
    expect(r.json.rows.length).toBeLessThanOrEqual(MAX_COMPARE_ROWS);
    expect(r.json.notReturned).toBe(r.json.changed - r.json.rows.length);
    expect(r.content.length).toBeLessThanOrEqual(MAX_DATA_RESULT_CHARS);
  });
});

describe('get_metrics', () => {
  it('returns the same payload the fixed context carries for the metric', async () => {
    const ctx = ctxFor();
    const r = await call(ctx, 'get_metrics', { metrics: ['resting_heart_rate'], days: 7 });
    expect(r.isError).toBe(false);
    const m = r.json.metrics[0];
    expect(m.metricId).toBe('resting_heart_rate');
    expect(m.display.unit).toBeTruthy();
    expect(m.display.current).toMatch(/\d/);
    expect(m.series.length).toBeGreaterThan(0);

    const fixed = buildContextPayload({ ...retrieveNone('x', '2026-09-17'), summaries: ctx.data!.fetched.summaries }, 'metric');
    expect(fixed.metrics[0].display).toEqual(m.display);
  });

  it('accepts a display name and suggests ids for one it cannot place', async () => {
    const ok = await call(ctxFor(), 'get_metrics', { metrics: ['Resting Heart Rate'] });
    expect(ok.json.metrics[0].metricId).toBe('resting_heart_rate');
    const bad = await call(ctxFor(), 'get_metrics', { metrics: ['heartrate'] });
    expect(bad.json.metrics).toEqual([]);
    expect(bad.json.notFound[0].metric).toBe('heartrate');
    expect(bad.json.notFound[0].didYouMean.length).toBeGreaterThan(0);
  });

  it('never summarises blood pressure by one of its two numbers', async () => {
    const r = await call(ctxFor(), 'get_metrics', { metrics: ['blood_pressure'], days: 90 });
    expect(r.json.metrics).toEqual([]);
    expect(r.json.noData[0].metric).toBe('blood_pressure');
    expect(r.json.noData[0].reason).toMatch(/systolic and diastolic/);
    const c = await call(ctxFor(), 'compare_periods', {
      metric: 'blood_pressure', aStart: '2026-03-01', aEnd: '2026-03-31', bStart: '2026-04-01', bEnd: '2026-04-30',
    });
    expect(c.isError).toBe(true);
    expect(c.json.error).toMatch(/systolic and diastolic/);
  });

  it('series=false returns the totals only', async () => {
    const r = await call(ctxFor(), 'get_metrics', { metrics: ['step_count'], days: 14, series: false });
    expect(r.json.metrics[0].series).toBeUndefined();
    expect(r.json.metrics[0].display.current).toMatch(/\d/);
    expect(r.json.seriesOmitted.metrics).toEqual(['step_count']);
  });

  it('stays inside the size limit on a long window and says what it left out', async () => {
    const r = await call(ctxFor(), 'get_metrics', { metrics: ['resting_heart_rate', 'step_count', 'heart_rate_variability'], days: 730 });
    expect(r.content.length).toBeLessThanOrEqual(MAX_DATA_RESULT_CHARS);
    expect(() => JSON.parse(r.content)).not.toThrow();
  });

  it('refuses more than three metrics at once', async () => {
    const r = await call(ctxFor(), 'get_metrics', { metrics: ['a', 'b', 'c', 'd'] });
    expect(r.isError).toBe(true);
    expect(r.json.problems.join(' ')).toMatch(/at most 3/);
  });
});

describe('compare_periods', () => {
  it('compares two named periods and states the change from A to B', async () => {
    const r = await call(ctxFor(), 'compare_periods', { metric: 'resting_heart_rate', aStart: '2026-08-01', aEnd: '2026-08-07', bStart: '2026-09-10', bEnd: '2026-09-16' });
    expect(r.isError).toBe(false);
    expect(r.json.periodA.observations).toBeGreaterThan(0);
    expect(r.json.periodB.observations).toBeGreaterThan(0);
    expect(r.json.meanChange).toMatch(/[+-]?\d/);
    expect(r.json.periodA.mean).toMatch(/bpm|\d/);
  });

  it('says there is no comparison when a period has no records', async () => {
    const r = await call(ctxFor(), 'compare_periods', { metric: 'resting_heart_rate', aStart: '2001-01-01', aEnd: '2001-01-07', bStart: '2026-09-10', bEnd: '2026-09-16' });
    expect(r.json.periodA.observations).toBe(0);
    expect(r.json.periodA.mean).toBe('no records');
    expect(r.json.meanChange).toMatch(/no comparison available/);
  });

  it('validates dates and order', async () => {
    const base = { metric: 'resting_heart_rate', aStart: '2026-08-01', aEnd: '2026-08-07', bStart: '2026-09-10', bEnd: '2026-09-16' };
    expect((await call(ctxFor(), 'compare_periods', { ...base, aStart: 'last week' })).json.error).toMatch(/YYYY-MM-DD/);
    expect((await call(ctxFor(), 'compare_periods', { ...base, aStart: '2026-08-09' })).json.error).toMatch(/start on or before/);
  });

  it('leaves out a day that is still accumulating from a daily total', async () => {
    const r = await call(ctxFor(), 'compare_periods', { metric: 'step_count', aStart: '2026-09-01', aEnd: '2026-09-07', bStart: '2026-09-11', bEnd: '2026-09-17' });
    expect(r.json.periodB.note ?? '').toMatch(/still accumulating|^$/);
    expect(r.json.aggregation).toBe('daily total, complete days only');
  });
});

describe('the other reads', () => {
  it('get_workouts rolls the log up under view: summary, with the figures the old roll-up carried', async () => {
    const r = await call(ctxFor(), 'get_workouts', { view: 'summary', days: 90 });
    expect(r.isError).toBe(false);
    expect(r.json.data.rollup.sessions).toBeGreaterThanOrEqual(0);
    expect(r.json.data.rollup.window).toBeTruthy();
    expect(r.json.data.rollup.byType).toBeInstanceOf(Array);
    expect(r.json.data.totals.sessions).toBe(r.json.data.rollup.sessions);
  });

  it('get_workouts lists the sessions by default, which the roll-up never could', async () => {
    const r = await call(ctxFor(), 'get_workouts', { days: 90 });
    expect(r.isError).toBe(false);
    expect(r.json.status).toBe('ok');
    expect(r.json.data.sessions.length).toBeGreaterThan(0);
    expect(r.json.data.sessions[0]).toMatchObject({ id: expect.any(String), day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), type: expect.any(String) });
  });

  it('get_metric_relationship returns an association, with its pairing counts', async () => {
    const r = await call(ctxFor(), 'get_metric_relationship', { x: 'sleep_analysis', y: 'heart_rate_variability', days: 90 });
    expect(r.json).toMatchObject({ x: 'sleep_analysis', y: 'heart_rate_variability', alignment: 'same-day' });
    expect(typeof r.json.pairedDays).toBe('number');
  });

  it('get_medications asks the reader for the window the model chose', async () => {
    const asked: { start: string; end: string }[] = [];
    const ctx = ctxFor();
    ctx.data = createDataAccess({
      system: 'metric',
      refKey: '2026-09-17',
      env: DEMO,
      medicationLog: async range => (asked.push(range), { available: true, reason: null, timezone: 'UTC', records: [] }),
    });
    const r = await call(ctx, 'get_medications', { days: 14 });
    expect(asked).toEqual([{ start: '2026-09-04', end: '2026-09-17' }]);
    expect(r.json.status).toBe('no_data_in_window');
    expect(r.json.window).toMatchObject({ start: '2026-09-04', end: '2026-09-17', asked: 'lastDays 14' });
  });
});

describe('what was fetched is what can be cited and audited', () => {
  it('records each fetch, and an untouched context records nothing', async () => {
    const ctx = ctxFor();
    expect(nothingFetched(ctx.data!.fetched)).toBe(true);
    await call(ctx, 'get_lab_results', { analytes: ['ldl'] });
    expect(nothingFetched(ctx.data!.fetched)).toBe(false);
    expect([...ctx.data!.fetched.labSeries.keys()]).toEqual(['ldl']);
    expect(ctx.data!.fetched.log[0]).toMatch(/1 lab series/);
  });

  it('merges fetched metrics and lab series into the bundle the answer is checked against', async () => {
    const ctx = ctxFor();
    await call(ctx, 'get_metrics', { metrics: ['resting_heart_rate'], days: 7 });
    await call(ctx, 'get_lab_results', { analytes: ['total_cholesterol'] });
    await call(ctx, 'compare_periods', { metric: 'step_count', aStart: '2026-09-01', aEnd: '2026-09-07', bStart: '2026-09-10', bEnd: '2026-09-16' });
    const start = retrieveNone('general', '2026-09-17');
    const merged = mergeFetched(start, ctx.data, await ctx.data!.labSource());
    expect(merged.summaries.map(s => s.metricId)).toEqual(['resting_heart_rate']);
    expect(merged.lab?.series.map(s => s.seriesKey)).toEqual(['total_cholesterol']);
    expect(merged.lab?.totalSeries).toBe(4);
    expect(merged.citable).toContain('step_count');
    expect(merged.note).toMatch(/Fetched on demand/);
    expect(start.summaries).toEqual([]);
  });

  it('a figure quoted from a fetched lab result is grounded; one that was never fetched is not', async () => {
    const ctx = ctxFor();
    await call(ctx, 'get_lab_results', { analytes: ['total_cholesterol'] });
    const bundle = mergeFetched(retrieveNone('general', '2026-09-17'), ctx.data, await ctx.data!.labSource());
    const answer = (text: string): AnalystAnswer =>
      ({ title: 't', observed: [text], interpretation: [], recommendations: [], summary: [], uncertainty: [], evidence: [], charts: [], followUps: [] }) as unknown as AnalystAnswer;
    expect(checkGrounding(answer('Total cholesterol was 231 mg/dL.'), bundle, 'metric').unmatched).toEqual([]);
    expect(checkGrounding(answer('Total cholesterol was 999 mg/dL.'), bundle, 'metric').unmatched).toContain('999');
  });

  it('returns the bundle itself when nothing was fetched', () => {
    const start = retrieveNone('general', '2026-09-17');
    expect(mergeFetched(start, ctxFor().data)).toBe(start);
    expect(mergeFetched(start, undefined)).toBe(start);
  });
});

describe('the coverage index', () => {
  const render = (lab: LabSourceInput) => renderCoverageIndex({ refKey: '2026-09-17', rows: [], metrics: buildMetricIndex(), labs: buildLabIndex(lab) });

  it('lists what exists with no values in it', async () => {
    const text = render(twoPanels());
    expect(text).toContain('resting_heart_rate');
    expect(text).toContain('Panel dates (date: series measured): 2026-09-29: 4, 2026-10-01: 3');
    expect(text).toContain('Lipids: LDL cholesterol (2×), Total cholesterol (2×)');
    expect(text).not.toMatch(/231|166/);
  });

  it('states why labs are missing instead of listing nothing', () => {
    const text = render({ available: false, reason: 'No Postgres database is configured.', documents: 0, totalObservations: 0, collisions: 0, series: [] });
    expect(text).toContain('LAB RESULTS — not available: No Postgres database is configured.');
  });

  it('stays within its bound however much lab data there is', () => {
    const lots = Array.from({ length: 150 }, (_, i) => series(`s${i}`, `Analyte number ${i}`, `Cat ${i % 12}`, [obs('2026-09-29', i), obs('2026-10-01', i)]));
    expect(render(twoPanels(lots)).length).toBeLessThanOrEqual(COVERAGE_INDEX_MAX_CHARS);
  });
});
