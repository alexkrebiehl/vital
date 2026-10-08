import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { formatDurationAggregate, formatMetricWithUnit } from '@/lib/metrics/format';
import { getMetric } from '@/lib/metrics';
import { pickFromDaily, resolveValueCard, type ValueCardData, type ValueResolveContext } from './value-resolve';
import { REF, install, obs } from './synthetic-dataset.fake';
import type { DateSpec } from './types';

const ctx: ValueResolveContext = { referenceKey: REF, system: 'metric' };
const resolve = (metricId: string, date: DateSpec, c = ctx) => resolveValueCard({ metricId, date }, c);
const today: DateSpec = { kind: 'today' };
const yesterday: DateSpec = { kind: 'yesterday' };
const range = (start: string, end: string): DateSpec => ({ kind: 'range', start, end });

function value(data: ValueCardData) {
  if (data.state !== 'value') throw new Error(`expected a value, got ${data.state}: ${JSON.stringify(data)}`);
  return data;
}

afterEach(() => resetToDemoDataset());

describe('sum metric (steps)', () => {
  const steps = [
    obs('2026-03-05', 4000),
    obs('2026-03-06', 6000),
    obs('2026-03-08', 8000, { partial: true }),
    obs('2026-03-09', 5000),
    obs('2026-03-10', 3000),
  ];

  it('today is "So far today", formatted by the registry, with no sparkline', () => {
    install({ step_count: steps });
    const d = value(resolve('step_count', today));
    expect(d.headline).toBe(formatMetricWithUnit('step_count', 3000, 'metric'));
    expect(d.qualifier).toBe('So far today');
    expect(d.dateLabel).toBe('Today · Mar 10, 2026');
    expect(d.spark).toBeUndefined();
  });

  it('yesterday is the day total', () => {
    install({ step_count: steps });
    const d = value(resolve('step_count', yesterday));
    expect(d.headline).toBe(formatMetricWithUnit('step_count', 5000, 'metric'));
    expect(d.qualifier).toBe('Day total');
    expect(d.spark).toBeUndefined();
  });

  it('a range totals complete days, excluding the reference day and partial days, with the notes', () => {
    install({ step_count: steps });
    const d = value(resolve('step_count', range('2026-03-05', '2026-03-10')));
    expect(d.headline).toBe(formatDurationAggregate('step_count', 15000, 'metric'));
    expect(d.qualifier).toBe('Total · 3 days with readings');
    expect(d.detail).toBe(`Avg ${formatMetricWithUnit('step_count', 5000, 'metric')} per day with a reading`);
    expect(d.note).toBe('Today excluded (still in progress). 1 incomplete day excluded.');
    expect(d.spark).toEqual({ kind: 'line', values: [4000, 6000, 5000] });
  });

  it('a range ending before today has no "today" note', () => {
    install({ step_count: steps });
    const d = value(resolve('step_count', range('2026-03-05', '2026-03-07')));
    expect(d.note).toBeUndefined();
    expect(d.headline).toBe(formatMetricWithUnit('step_count', 10000, 'metric'));
  });

  it('a single past day flagged partial is shown with a note, not as a complete total', () => {
    install({ step_count: steps });
    const d = value(resolve('step_count', range('2026-03-08', '2026-03-08')));
    expect(d.headline).toBe(formatMetricWithUnit('step_count', 8000, 'metric'));
    expect(d.note).toBe('This day’s record is incomplete.');
  });

  it('a range whose only reading is today says it is still in progress', () => {
    install({ step_count: [obs('2026-03-10', 3000)] });
    expect(resolve('step_count', range('2026-03-08', '2026-03-10'))).toEqual({
      state: 'no-reading',
      dateLabel: 'Mar 8 – Mar 10, 2026',
      reason: "The only reading in this range is today's, which is still in progress.",
    });
  });

  it('a range whose only readings are earlier partial days says so', () => {
    install({ step_count: [obs('2026-03-08', 3000, { partial: true })] });
    const d = resolve('step_count', range('2026-03-05', '2026-03-09'));
    expect(d).toMatchObject({ state: 'no-reading', reason: 'The only readings in this range are from incomplete days.' });
  });

  it('groups two points of one day before aggregating', () => {
    install({ step_count: [obs('2026-03-09', 2000), obs('2026-03-09', 3000)] });
    expect(value(resolve('step_count', yesterday)).headline).toBe(formatMetricWithUnit('step_count', 5000, 'metric'));
  });
});

describe('avg metric (resting heart rate)', () => {
  const hr = [obs('2026-03-06', 60), obs('2026-03-08', 64), obs('2026-03-10', 68)];

  it('a single day is that day’s value', () => {
    install({ resting_heart_rate: hr });
    const d = value(resolve('resting_heart_rate', today));
    expect(d.headline).toBe(formatMetricWithUnit('resting_heart_rate', 68, 'metric'));
    expect(d.spark).toBeUndefined();
  });

  it('a range is the mean of days with readings, and says how many', () => {
    install({ resting_heart_rate: hr });
    const d = value(resolve('resting_heart_rate', range('2026-03-01', '2026-03-10')));
    expect(d.headline).toBe(formatMetricWithUnit('resting_heart_rate', 64, 'metric'));
    expect(d.qualifier).toBe('Average · 3 days with readings');
    expect(d.spark).toEqual({ kind: 'line', values: [60, 64, 68] });
  });

  it('one daily value in a range draws no sparkline and says "1 day"', () => {
    install({ resting_heart_rate: hr });
    const d = value(resolve('resting_heart_rate', range('2026-03-07', '2026-03-09')));
    expect(d.qualifier).toBe('Average · 1 day with readings');
    expect(d.spark).toBeUndefined();
  });

  it('honours the unit system', () => {
    install({ weight_body_mass: [obs('2026-03-09', 80)] });
    const d = value(resolve('weight_body_mass', yesterday, { referenceKey: REF, system: 'imperial' }));
    expect(d.headline).toBe(formatMetricWithUnit('weight_body_mass', 80, 'imperial'));
  });
});

describe('latest metric (VO2 max)', () => {
  it('a range shows the last daily value with its date', () => {
    install({ vo2max: [obs('2026-03-02', 40), obs('2026-03-07', 42)] });
    const d = value(resolve('vo2max', range('2026-03-01', '2026-03-10')));
    expect(d.headline).toBe(formatMetricWithUnit('vo2max', 42, 'metric'));
    expect(d.qualifier).toBe('Latest · Mar 7, 2026');
  });
});

describe('min and max', () => {
  const daily = [
    { key: '2026-03-01', value: 5 },
    { key: '2026-03-02', value: 2 },
    { key: '2026-03-03', value: 9 },
  ];
  it('pick the lowest or highest daily value with its date', () => {
    expect(pickFromDaily('min', daily)).toEqual({ value: 2, key: '2026-03-02', label: 'Lowest' });
    expect(pickFromDaily('max', daily)).toEqual({ value: 9, key: '2026-03-03', label: 'Highest' });
  });
  it('latest and avg carry no date', () => {
    expect(pickFromDaily('latest', daily)).toEqual({ value: 9, key: '2026-03-03', label: 'Latest' });
    expect(pickFromDaily('avg', daily)).toMatchObject({ value: (5 + 2 + 9) / 3, label: 'Average' });
  });
});

describe('duration aggregates', () => {
  it('a range prints h:mm; a single day keeps the registry form', () => {
    install({ apple_exercise_time: [obs('2026-03-08', 30), obs('2026-03-09', 55)] });
    expect(value(resolve('apple_exercise_time', range('2026-03-05', '2026-03-09'))).headline).toBe('1:25');
    expect(value(resolve('apple_exercise_time', yesterday)).headline).toBe(
      formatMetricWithUnit('apple_exercise_time', 55, 'metric')
    );
  });
});

describe('states, in order', () => {
  it('1. an unregistered metric', () => {
    install({});
    expect(resolve('not_a_metric', today)).toEqual({
      state: 'unknown-metric',
      reason: 'This metric is not part of this version of Vital.',
    });
  });

  it('2. no data for the metric: the demo reason, or the live one', () => {
    install({});
    const demo = resolve('step_count', today);
    expect(demo).toEqual({
      state: 'unavailable',
      dateLabel: 'Today · Mar 10, 2026',
      reason: getMetric('step_count')?.unavailableReason ?? 'No observations of this metric are present in the dataset.',
    });
    install({}, 'live');
    expect(resolve('step_count', today)).toMatchObject({
      state: 'unavailable',
      reason: 'No readings of this metric are recorded.',
    });
  });

  it('2 comes before 3: unavailable wins over a future range', () => {
    install({});
    expect(resolve('step_count', range('2026-03-11', '2026-03-12')).state).toBe('unavailable');
  });

  it('3. a range wholly after the reference day', () => {
    install({ step_count: [obs('2026-03-05', 4000)] });
    expect(resolve('step_count', range('2026-03-11', '2026-03-15'))).toEqual({
      state: 'no-reading',
      dateLabel: 'Mar 11 – Mar 15, 2026',
      reason: 'These dates are after the latest day in the data (Mar 10, 2026).',
    });
  });

  it('4. no point in the window: yesterday, today (sum), today (avg) and a range', () => {
    install({ step_count: [obs('2026-03-05', 4000)], resting_heart_rate: [obs('2026-03-05', 60)] });
    expect(resolve('step_count', yesterday)).toMatchObject({ state: 'no-reading', reason: 'No Steps reading on Mar 9, 2026.' });
    expect(resolve('step_count', today)).toMatchObject({ state: 'no-reading', reason: 'Nothing recorded yet today.' });
    const name = getMetric('resting_heart_rate')!.displayName;
    expect(resolve('resting_heart_rate', today)).toMatchObject({
      state: 'no-reading',
      reason: `No ${name} reading on Mar 10, 2026.`,
    });
    expect(resolve('step_count', range('2026-03-01', '2026-03-04'))).toMatchObject({
      state: 'no-reading',
      reason: 'No Steps readings between Mar 1, 2026 and Mar 4, 2026.',
    });
  });

  it('never renders a zero or a placeholder dash for a missing day', () => {
    install({ step_count: [obs('2026-03-05', 4000)] });
    for (const date of [today, yesterday, range('2026-03-01', '2026-03-04')]) {
      const d = resolve('step_count', date);
      expect(d.state).toBe('no-reading');
      expect(JSON.stringify(d)).not.toMatch(/"(headline|value)"/);
    }
  });
});
