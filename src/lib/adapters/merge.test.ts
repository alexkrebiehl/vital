import { describe, expect, it } from 'vitest';
import type { MetricObservation, SleepObservation, WorkoutRecord } from '@/lib/metrics/types';
import { buildLiveDataset, type BuiltDataset, type RawMetricBundle } from './normalize';
import { MERGE_RULE, mergeDatasets, preferRingFromGroups, type DatasetFrame } from './merge';
import { OURA_SOURCE_NAME, type OuraContribution } from './oura/normalize';

// Synthetic data throughout. "Sample's Apple Watch" stands for the watch.

const WATCH = "Sample's Apple Watch";
const TZ = 'America/Chicago';
const NOW = '2026-09-17T12:00:00-05:00';

const stepRaw = (date: string, qty: number) => ({ date, qty, units: 'count', source: WATCH });
const sleepRaw = (date: string, deep: number) => ({
  date: `${date}T07:00:00-05:00`, source: WATCH, deep, rem: 1.5, core: 4, awake: 0.5,
  inBedStart: `${date}T00:00:00-05:00`, inBedEnd: `${date}T07:00:00-05:00`,
});
const watchWorkout = (id: string, start: string, end: string) => ({
  id, workout_type: 'Walking', start_time: start, end_time: end, duration_minutes: 30, calories_burned: 120,
});

function haePart(): BuiltDataset {
  const raw: RawMetricBundle = {
    metrics: {
      step_count: [stepRaw('2026-09-10T12:00:00-05:00', 5000), stepRaw('2026-09-11T12:00:00-05:00', 6000)],
      resting_heart_rate: [{ date: '2026-09-10T06:00:00-05:00', qty: 58, units: 'count/min', source: WATCH }],
      sleep_analysis: [sleepRaw('2026-09-10', 1.2), sleepRaw('2026-09-11', 1.3)],
    },
    workouts: [watchWorkout('hae-1', '2026-09-10T08:00:00-05:00', '2026-09-10T08:30:00-05:00')],
  };
  return buildLiveDataset(raw, { tz: TZ, now: NOW, referenceKey: '2026-09-17' });
}

const obs = (id: string, date: string, qty: number, units = 'count'): MetricObservation =>
  ({ date, qty, units, source: OURA_SOURCE_NAME });
const night = (date: string, asleep: number): SleepObservation => ({
  date, bedtime: `${date}T00:00:00-05:00`, wakeTime: `${date}T07:00:00-05:00`, durationMinutes: asleep + 30,
  inBedMinutes: asleep + 30, asleepMinutes: asleep, stages: { deep: 60, rem: 90, core: asleep - 150, awake: 30 },
  source: OURA_SOURCE_NAME,
});
const ouraWorkout = (id: string, start: string, end: string): WorkoutRecord => ({
  id: `oura:${id}`, workout_type: 'Walking', start_time: start, end_time: end, duration_minutes: 30,
  calories_burned: null, source: OURA_SOURCE_NAME,
});

function cov(first: string, last: string, days: number) {
  return { firstObservation: first, lastObservation: last, observedDays: days, expectedDays: 8, samplingFrequency: 'daily', sourceNames: [OURA_SOURCE_NAME] };
}
function prov(metricId: string, n: number, first: string, last: string) {
  return {
    metricId, haeMetric: `x.${metricId}`, aggregation: 'sum' as const, canonicalUnit: 'count', sources: [OURA_SOURCE_NAME],
    observations: n, recordsRead: n, recordsKept: n, firstDay: first, lastDay: last, unitConversions: [], dedupeRule: 'r',
  };
}

function ouraPart(): OuraContribution {
  return {
    metrics: {
      step_count: [obs('s', '2026-09-11', 7777), obs('s', '2026-09-12', 8888)],
      sleep_analysis: [night('2026-09-11', 400), night('2026-09-12', 410)],
      hrv_rmssd_sleep: [obs('h', '2026-09-11', 55, 'ms')],
    },
    coverage: {
      step_count: cov('2026-09-11', '2026-09-12', 2),
      sleep_analysis: cov('2026-09-11', '2026-09-12', 2),
      hrv_rmssd_sleep: cov('2026-09-11', '2026-09-11', 1),
    },
    workouts: [
      ouraWorkout('o1', '2026-09-10T08:02:00-05:00', '2026-09-10T08:31:00-05:00'),
      ouraWorkout('o2', '2026-09-12T09:00:00-05:00', '2026-09-12T09:30:00-05:00'),
    ],
    provenance: [prov('step_count', 2, '2026-09-11', '2026-09-12'), prov('sleep_analysis', 2, '2026-09-11', '2026-09-12'), prov('hrv_rmssd_sleep', 1, '2026-09-11', '2026-09-11')],
    recordsRead: 9,
    sources: [OURA_SOURCE_NAME],
  };
}

const RING = new Set(['sleep_analysis', 'respiratory_rate', 'blood_oxygen_saturation']);
const WATCH_WINS = new Set<string>();
const series = (m: BuiltDataset | null, id: string) => (m?.dataset.metrics[id] ?? []) as (MetricObservation & SleepObservation)[];
const dayQty = (m: BuiltDataset | null, id: string) => series(m, id).map(o => [o.date, o.qty] as const);
const FRAME: DatasetFrame = { referenceDate: NOW, timezone: TZ };

describe('mergeDatasets: a missing source never existed', () => {
  it('returns the HAE part deep-equal when Oura is null', () => {
    const hae = haePart();
    const before = JSON.parse(JSON.stringify(hae));
    expect(mergeDatasets(hae, null, { preferRing: RING })).toEqual(hae);
    expect(mergeDatasets(hae, null, { preferRing: new Set() })).toEqual(hae);
    expect(hae).toEqual(before);
  });

  it('returns nothing when both are null', () => {
    expect(mergeDatasets(null, null, { preferRing: RING })).toBeNull();
  });

  it('with no HAE, returns the ring contribution as a dataset, values unchanged', () => {
    const oura = ouraPart();
    const out = mergeDatasets(null, oura, { preferRing: RING }, FRAME)!;
    expect(out.dataset.metrics).toEqual(oura.metrics);
    expect(out.dataset.workouts).toEqual(oura.workouts);
    expect(out.dataset.coverage).toEqual(oura.coverage);
    expect(out.dataset.timezone).toBe(TZ);
    expect(out.dataset.referenceDate).toBe(NOW);
    expect(out.provenance).toEqual(oura.provenance);
    expect(out.stats).toMatchObject({ recordsRead: 9, workouts: 2, metrics: 3, observations: 5, droppedRecords: 0 });
  });

  it('refuses to invent a dataset frame for a ring-only merge', () => {
    expect(() => mergeDatasets(null, ouraPart(), { preferRing: RING })).toThrow(/frame/);
  });
});

describe('mergeDatasets: one value per day, never combined', () => {
  it('the watch wins a shared day when it is preferred; the ring fills the days the watch lacks', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: WATCH_WINS })!;
    expect(dayQty(out, 'step_count')).toEqual([['2026-09-10', 5000], ['2026-09-11', 6000], ['2026-09-12', 8888]]);
  });

  it('the ring wins a shared day when it is preferred; the watch fills the rest', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: new Set(['step_count']) })!;
    expect(dayQty(out, 'step_count')).toEqual([['2026-09-10', 5000], ['2026-09-11', 7777], ['2026-09-12', 8888]]);
  });

  it('never sums or averages across sources', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: new Set(['step_count']) })!;
    const values = series(out, 'step_count').map(o => o.qty);
    expect(values).not.toContain(5000 + 7777);
    expect(values).not.toContain(6000 + 7777);
    expect(new Set(series(out, 'step_count').map(o => o.date)).size).toBe(values.length);
  });

  it('passes ring-only metrics through and keeps watch-only metrics untouched', () => {
    const hae = haePart();
    const out = mergeDatasets(hae, ouraPart(), { preferRing: RING })!;
    expect(out.dataset.metrics['hrv_rmssd_sleep']).toEqual(ouraPart().metrics['hrv_rmssd_sleep']);
    expect(out.dataset.metrics['resting_heart_rate']).toBe(hae.dataset.metrics['resting_heart_rate']);
    expect(out.dataset.coverage['resting_heart_rate']).toBe(hae.dataset.coverage['resting_heart_rate']);
  });
});

describe('mergeDatasets: sleep is one episode per night', () => {
  it('keeps one episode per night from the preferred source and fills missing nights from the other', () => {
    const ring = mergeDatasets(haePart(), ouraPart(), { preferRing: RING })!;
    const nights = series(ring, 'sleep_analysis');
    expect(nights.map(n => n.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(nights.map(n => n.source)).toEqual([expect.stringContaining('Watch'), OURA_SOURCE_NAME, OURA_SOURCE_NAME]);
    expect(nights[1].asleepMinutes).toBe(400);

    const watch = mergeDatasets(haePart(), ouraPart(), { preferRing: WATCH_WINS })!;
    const wn = series(watch, 'sleep_analysis');
    expect(wn.map(n => n.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(wn[1].source).toContain('Watch');
    expect(wn[2].source).toBe(OURA_SOURCE_NAME);
  });
});

describe('mergeDatasets: workouts', () => {
  it('collapses an overlapping pair to the preferred source and keeps both when they only touch', () => {
    const watchPref = mergeDatasets(haePart(), ouraPart(), { preferRing: WATCH_WINS })!;
    expect(watchPref.dataset.workouts.map(w => w.id)).toEqual(['hae-1', 'oura:o2']);
    const ringPref = mergeDatasets(haePart(), ouraPart(), { preferRing: new Set(['workouts']) })!;
    expect(ringPref.dataset.workouts.map(w => w.id)).toEqual(['oura:o1', 'oura:o2']);
  });

  it('keeps two adjacent, non-overlapping workouts', () => {
    const oura = ouraPart();
    oura.workouts = [ouraWorkout('adj', '2026-09-10T08:30:00-05:00', '2026-09-10T09:00:00-05:00')];
    const out = mergeDatasets(haePart(), oura, { preferRing: WATCH_WINS })!;
    expect(out.dataset.workouts.map(w => w.id)).toEqual(['hae-1', 'oura:adj']);
  });

  it('keeps the preferred record whole, without borrowing from the other', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: new Set(['workouts']) })!;
    expect(out.dataset.workouts[0].calories_burned).toBeNull();
  });
});

describe('mergeDatasets: coverage, provenance and counts', () => {
  it('recomputes coverage from the merged series with the union of sources', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: WATCH_WINS })!;
    const c = out.dataset.coverage['step_count'];
    expect(c.observedDays).toBe(3);
    expect(c.sourceNames).toEqual([WATCH, OURA_SOURCE_NAME].sort());
    expect(out.dataset.coverage['sleep_analysis'].observedDays).toBe(3);
  });

  it('lists a source only if something of it survived', () => {
    const oura = ouraPart();
    oura.metrics.step_count = [obs('s', '2026-09-11', 7777)];
    const out = mergeDatasets(haePart(), oura, { preferRing: WATCH_WINS })!;
    expect(out.dataset.coverage['step_count'].sourceNames).toEqual([WATCH]);
  });

  it('keeps one provenance row per metric and source, with the kept counts', () => {
    const out = mergeDatasets(haePart(), ouraPart(), { preferRing: new Set(['step_count']) })!;
    const rows = out.provenance.filter(p => p.metricId === 'step_count');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.sources.includes(OURA_SOURCE_NAME))).toMatchObject({ observations: 2 });
    expect(rows.find(r => r.sources.includes(WATCH))).toMatchObject({ observations: 1, firstDay: '2026-09-10', lastDay: '2026-09-10' });
    expect(rows.every(r => r.dedupeRule.includes(MERGE_RULE))).toBe(true);
    expect(out.provenance.filter(p => p.metricId === 'resting_heart_rate')).toHaveLength(1);
  });

  it('adds the merge layer to the dropped counts', () => {
    const hae = haePart();
    const out = mergeDatasets(hae, ouraPart(), { preferRing: WATCH_WINS })!;
    // 1 shared step day, 1 shared night, 1 overlapping workout
    expect(out.stats.droppedRecords).toBe(hae.stats.droppedRecords + 3);
    expect(out.stats.droppedIntervals).toBe(hae.stats.droppedIntervals + 2);
    expect(out.stats.recordsRead).toBe(hae.stats.recordsRead + 9);
    expect(out.stats.workouts).toBe(out.dataset.workouts.length);
    expect(out.stats.metrics).toBe(Object.keys(out.dataset.metrics).length);
  });

  it('counts observations as the sum of the merged series, whoever is preferred', () => {
    for (const prefer of [WATCH_WINS, RING, new Set(['step_count', 'sleep_analysis'])]) {
      const out = mergeDatasets(haePart(), ouraPart(), { preferRing: prefer })!;
      const total = Object.values(out.dataset.metrics).reduce((n, rows) => n + rows.length, 0);
      expect(out.stats.observations).toBe(total);
    }
  });

  it('widens the window to the ring data and states the rule', () => {
    const oura = ouraPart();
    oura.metrics.step_count = [obs('s', '2026-09-01', 4000)];
    oura.coverage.step_count = cov('2026-09-01', '2026-09-01', 1);
    const hae = haePart();
    const out = mergeDatasets(hae, oura, { preferRing: WATCH_WINS })!;
    expect(Date.parse(out.dataset.windowStart)).toBeLessThanOrEqual(Date.parse(hae.dataset.windowStart));
    expect(out.dataset.days).toBeGreaterThan(hae.dataset.days);
    expect(MERGE_RULE).toMatch(/never (added|summed)/i);
  });

  it('turns preferred groups into metric ids', () => {
    const set = preferRingFromGroups(['sleep', 'workouts']);
    expect(set.has('sleep_analysis')).toBe(true);
    expect(set.has('workouts')).toBe(true);
    expect(set.has('step_count')).toBe(false);
  });
});
