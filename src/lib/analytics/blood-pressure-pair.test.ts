// ── Blood pressure is a PAIR: every statistic is per series ─────────────────
//
// Owner report: with a reading of 111/71 mmHg the chart showed only 111. A
// systolic-only number labelled "blood pressure" is inconclusive, so every
// statistic is computed for systolic and diastolic separately and shown as a
// pair. Fixtures here are synthetic.

import { describe, expect, it } from 'vitest';
import {
  bloodPressureBaseline,
  bloodPressureChange,
  bloodPressureStats,
  completeBloodPressureReadings,
} from '@/lib/analytics';
import type { BloodPressureObservation } from '@/lib/metrics/types';

function reading(date: string, systolic: number, diastolic: number): BloodPressureObservation {
  return { date, systolic, diastolic, units: 'mmHg', source: 'test cuff' };
}

describe('completeBloodPressureReadings', () => {
  it('drops a reading that lacks either number, never showing it half', () => {
    const records = [
      reading('2026-09-01', 111, 71),
      { ...reading('2026-09-02', 120, 80), diastolic: Number.NaN },
      { ...reading('2026-09-03', 120, 80), systolic: undefined as unknown as number },
      reading('2026-09-04', 118, 76),
    ];
    expect(completeBloodPressureReadings(records).map(r => r.date)).toEqual(['2026-09-01', '2026-09-04']);
  });
});

describe('bloodPressureStats', () => {
  const records = [reading('2026-09-01', 110, 70), reading('2026-09-02', 114, 72), reading('2026-09-02', 120, 80)];

  it('computes mean, min, max and median for each series separately', () => {
    const s = bloodPressureStats(records)!;
    expect(s.count).toBe(3);
    expect(s.systolic.mean).toBeCloseTo((110 + 114 + 120) / 3, 6);
    expect(s.diastolic.mean).toBeCloseTo((70 + 72 + 80) / 3, 6);
    expect([s.systolic.min, s.systolic.max, s.systolic.median]).toEqual([110, 120, 114]);
    expect([s.diastolic.min, s.diastolic.max, s.diastolic.median]).toEqual([70, 80, 72]);
  });

  it('is null for no readings, not a pair of zeros', () => {
    expect(bloodPressureStats([])).toBeNull();
    expect(bloodPressureStats([{ ...reading('2026-09-01', 1, 1), diastolic: Number.NaN }])).toBeNull();
  });
});

describe('bloodPressureBaseline', () => {
  it('gives a mean and a spread band for each series', () => {
    const b = bloodPressureBaseline([
      reading('2026-08-01', 110, 70),
      reading('2026-08-02', 120, 80),
      reading('2026-08-03', 130, 90),
    ])!;
    expect(b.count).toBe(3);
    expect(b.systolic).toEqual({ mean: 120, low: 110, high: 130 });
    expect(b.diastolic).toEqual({ mean: 80, low: 70, high: 90 });
  });

  it('collapses the band onto the mean when one reading cannot give a spread', () => {
    const b = bloodPressureBaseline([reading('2026-08-01', 111, 71)])!;
    expect(b.systolic).toEqual({ mean: 111, low: 111, high: 111 });
  });

  it('is null with no readings', () => {
    expect(bloodPressureBaseline([])).toBeNull();
  });
});

describe('bloodPressureChange', () => {
  it('is the difference of the two means for each series', () => {
    const now = [reading('2026-09-05', 114, 74), reading('2026-09-06', 116, 76)];
    const before = [reading('2026-08-05', 110, 70), reading('2026-08-06', 112, 72)];
    const c = bloodPressureChange(now, before)!;
    expect(c.systolic).toBeCloseTo(4, 6);
    expect(c.diastolic).toBeCloseTo(4, 6);
  });

  it('is null when either side has no readings', () => {
    expect(bloodPressureChange([], [reading('2026-08-05', 110, 70)])).toBeNull();
    expect(bloodPressureChange([reading('2026-08-05', 110, 70)], [])).toBeNull();
  });
});
