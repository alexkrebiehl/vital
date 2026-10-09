// ── seriesFor('blood_pressure') must not pretend to be one number ───────────
//
// It used to map every reading to its systolic value, so every generic chart,
// stat, baseline and briefing line saw 111 for a 111/71 reading. A pair is read
// through bloodPressureSeries(); the single-number dispatcher yields nothing for
// it, and the presence helpers still know the readings exist.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIXTURES,
  bloodPressureSeries,
  metricHasData,
  metricObservationCount,
  resetToDemoDataset,
  seriesFor,
  seriesInWindow,
  setActiveDataset,
} from '@/lib/adapters/dataset';
import type { HealthFixtures } from '@/lib/metrics/types';

const REF = FIXTURES.referenceDate.slice(0, 10);

function withReadings(readings: { date: string; systolic: number; diastolic: number }[]): HealthFixtures {
  return {
    ...FIXTURES,
    metrics: {
      ...FIXTURES.metrics,
      blood_pressure: readings.map(r => ({ ...r, units: 'mmHg', source: 'test cuff' })),
    },
  };
}

describe('blood pressure in the dataset', () => {
  beforeEach(() => {
    setActiveDataset(
      withReadings([
        { date: '2026-03-01', systolic: 111, diastolic: 71 },
        { date: '2026-03-01', systolic: 125, diastolic: 82 },
        { date: '2026-03-02', systolic: 118, diastolic: 76 },
      ]),
      { mode: 'demo' }
    );
  });
  afterEach(() => resetToDemoDataset());

  it('keeps both numbers of every reading, in order', () => {
    expect(bloodPressureSeries().map(r => `${r.date} ${r.systolic}/${r.diastolic}`)).toEqual([
      '2026-03-01 111/71',
      '2026-03-01 125/82',
      '2026-03-02 118/76',
    ]);
  });

  it('is no longer a systolic-only single series', () => {
    expect(seriesFor('blood_pressure')).toEqual([]);
    expect(seriesInWindow('blood_pressure', { startKey: '2026-01-01', endKey: '2026-12-31', label: 'all' })).toEqual([]);
  });

  it('still reports that blood pressure has data, and how many readings', () => {
    expect(metricHasData('blood_pressure')).toBe(true);
    expect(metricObservationCount('blood_pressure')).toBe(3);
  });
});

describe('blood pressure with no readings', () => {
  afterEach(() => resetToDemoDataset());

  it('reports no data', () => {
    setActiveDataset(withReadings([]), { mode: 'demo' });
    expect(metricHasData('blood_pressure')).toBe(false);
    expect(metricObservationCount('blood_pressure')).toBe(0);
    expect(REF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
