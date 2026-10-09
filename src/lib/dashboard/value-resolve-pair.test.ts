// Blood pressure is a pair and sleep is drawn with its stages: neither is ever
// reduced to one number or one line.

import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset, seriesFor } from '@/lib/adapters/dataset';
import { getAllMetrics } from '@/lib/metrics';
import { formatBloodPressure, formatMetricWithUnit } from '@/lib/metrics/format';
import { resolveValueCard, type ValueCardData, type ValueResolveContext } from './value-resolve';
import { REF, bp, install, night } from './synthetic-dataset.fake';
import type { DateSpec } from './types';

const ctx: ValueResolveContext = { referenceKey: REF, system: 'metric' };
const resolve = (metricId: string, date: DateSpec) => resolveValueCard({ metricId, date }, ctx);
const range = (start: string, end: string): DateSpec => ({ kind: 'range', start, end });

function value(data: ValueCardData) {
  if (data.state !== 'value') throw new Error(`expected a value, got ${data.state}`);
  return data;
}

afterEach(() => resetToDemoDataset());

describe('blood pressure', () => {
  const readings = [
    bp('2026-03-09', 111, 71),
    bp('2026-03-09', 125, 82),
    bp('2026-03-09', 118, 76),
    bp('2026-03-05', 120, 80),
    bp('2026-03-10', 130, 85),
  ];

  it('one day with three readings shows the last as a pair, and how many', () => {
    install({ blood_pressure: readings });
    const d = value(resolve('blood_pressure', { kind: 'yesterday' }));
    expect(d.headline).toBe(formatBloodPressure(118, 76, 'metric'));
    expect(d.headline).toBe('118/76 mmHg');
    expect(d.qualifier).toBe('Latest of 3 readings');
    expect(d.spark).toBeUndefined();
  });

  it('a day with one reading has no count qualifier', () => {
    install({ blood_pressure: readings });
    const d = value(resolve('blood_pressure', { kind: 'today' }));
    expect(d.headline).toBe('130/85 mmHg');
    expect(d.qualifier).toBe('');
  });

  it('the owner’s example 111/71 renders both numbers', () => {
    install({ blood_pressure: [bp('2026-03-09', 111, 71)] });
    const d = value(resolve('blood_pressure', { kind: 'yesterday' }));
    expect(d.headline).toBe('111/71 mmHg');
    expect(d.headline).not.toBe('111 mmHg');
  });

  it('a range shows the latest reading plus each series’ average, with a pair sparkline', () => {
    install({ blood_pressure: readings });
    const d = value(resolve('blood_pressure', range('2026-03-01', '2026-03-10')));
    expect(d.headline).toBe('130/85 mmHg');
    expect(d.qualifier).toBe('Latest · Mar 10, 2026');
    // mean systolic (120+111+125+118+130)/5 = 120.8, diastolic (80+71+82+76+85)/5 = 78.8
    expect(d.detail).toBe(`Average ${formatBloodPressure(120.8, 78.8, 'metric')} · 5 readings`);
    expect(d.spark?.kind).toBe('pair');
    if (d.spark?.kind === 'pair') expect(d.spark.readings).toHaveLength(5);
  });

  it('a range with one reading says "1 reading" and draws no sparkline', () => {
    install({ blood_pressure: readings });
    const d = value(resolve('blood_pressure', range('2026-03-04', '2026-03-06')));
    expect(d.detail).toMatch(/· 1 reading$/);
    expect(d.spark).toBeUndefined();
  });

  it('a reading missing a number is dropped, never shown half', () => {
    install({
      blood_pressure: [bp('2026-03-09', 111, 71), { ...bp('2026-03-09', 200, 100), diastolic: NaN }],
    });
    const d = value(resolve('blood_pressure', { kind: 'yesterday' }));
    expect(d.headline).toBe('111/71 mmHg');
    expect(d.qualifier).toBe('');
  });

  it('no reading in the window gives a reason, not a number', () => {
    install({ blood_pressure: readings });
    expect(resolve('blood_pressure', range('2026-03-06', '2026-03-08'))).toMatchObject({
      state: 'no-reading',
      reason: expect.stringMatching(/^No Blood Pressure readings between Mar 6, 2026 and Mar 8, 2026\.$/i),
    });
  });

  it('with no readings at all the card is unavailable', () => {
    install({});
    expect(resolve('blood_pressure', { kind: 'today' }).state).toBe('unavailable');
  });
});

describe('sleep', () => {
  const nights = [
    night('2026-03-07', 420, 460),
    night('2026-03-08', 400, 450),
    night('2026-03-09', 0, 480, false), // in bed only: no time asleep
    night('2026-03-10', 450, 500),
  ];

  it('today is last night, with no sparkline', () => {
    install({ sleep_analysis: nights });
    const d = value(resolve('sleep_analysis', { kind: 'today' }));
    expect(d.headline).toBe(formatMetricWithUnit('sleep_analysis', 450, 'metric'));
    expect(d.spark).toBeUndefined();
  });

  it('an in-bed-only night is not counted and is not a zero', () => {
    install({ sleep_analysis: nights });
    expect(resolve('sleep_analysis', { kind: 'yesterday' })).toMatchObject({ state: 'no-reading' });
    const d = value(resolve('sleep_analysis', range('2026-03-06', '2026-03-10')));
    expect(d.qualifier).toBe('Average · 3 nights');
    expect(d.headline).toBe(formatMetricWithUnit('sleep_analysis', (420 + 400 + 450) / 3, 'metric'));
    expect(d.spark).toBeUndefined();
  });

  it('one night in a range reads "1 night"', () => {
    install({ sleep_analysis: nights });
    expect(value(resolve('sleep_analysis', range('2026-03-10', '2026-03-10'))).qualifier).toBe('');
    expect(value(resolve('sleep_analysis', range('2026-03-09', '2026-03-10'))).qualifier).toBe('Average · 1 night');
  });

  it('time in bed counts the in-bed-only night, as a plain metric', () => {
    install({ sleep_analysis: nights });
    const d = value(resolve('sleep_in_bed', range('2026-03-06', '2026-03-10')));
    expect(d.qualifier).toBe('Average · 4 days with readings');
  });
});

describe('committed fixtures', () => {
  it('no plain metric carries two points for one day (the resolver groups them anyway)', () => {
    const dup: string[] = [];
    for (const m of getAllMetrics()) {
      const keys = seriesFor(m.id).map(p => p.key);
      if (new Set(keys).size !== keys.length) dup.push(m.id);
    }
    expect(dup).toEqual([]);
  });

  it('every registered metric uses a strategy the resolver supports', () => {
    const supported = ['avg', 'sum', 'latest', 'min', 'max'];
    expect(getAllMetrics().filter(m => !supported.includes(m.aggregationStrategy)).map(m => m.id)).toEqual([]);
  });
});
