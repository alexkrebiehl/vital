// ── Synthetic datasets for the Dashboard tests ──────────────────────────────
//
// Invented numbers on an invented reference day. Assertions about values never
// read the committed fixtures. `install` goes through `setActiveDataset`, so
// every dataset helper (and REFERENCE_KEY) sees this data; call
// `resetToDemoDataset` in afterEach.

import { FIXTURES, setActiveDataset, type DataMode } from '@/lib/adapters/dataset';
import type {
  BloodPressureObservation,
  HealthFixtures,
  MetricObservation,
  SleepObservation,
} from '@/lib/metrics/types';

/** The synthetic reference day: "today" in these datasets. */
export const REF = '2026-03-10';

type Series = MetricObservation[] | SleepObservation[] | BloodPressureObservation[];

export function dataset(metrics: Record<string, Series> = {}): HealthFixtures {
  return {
    ...FIXTURES,
    referenceDate: `${REF}T18:00:00.000Z`,
    windowStart: '2026-01-01T06:00:00.000Z',
    windowEnd: `${REF}T18:00:00.000Z`,
    timezone: 'America/Chicago',
    metrics,
    workouts: [],
    coverage: {},
  };
}

export function install(metrics: Record<string, Series> = {}, mode: DataMode = 'demo'): void {
  setActiveDataset(dataset(metrics), { mode });
}

export function obs(date: string, qty: number, extra: Partial<MetricObservation> = {}): MetricObservation {
  return { date, qty, units: '', source: 'test', ...extra };
}

export function bp(date: string, systolic: number, diastolic: number): BloodPressureObservation {
  return { date, systolic, diastolic, units: 'mmHg', source: 'test' };
}

/** A night keyed by its waking day. `stages` omitted → an in-bed-only record. */
export function night(date: string, asleep: number, inBed: number, withStages = true): SleepObservation {
  const deep = withStages ? Math.round(asleep * 0.2) : 0;
  const rem = withStages ? Math.round(asleep * 0.25) : 0;
  return {
    date,
    bedtime: `${date}T04:00:00.000Z`,
    wakeTime: `${date}T12:00:00.000Z`,
    durationMinutes: inBed,
    inBedMinutes: inBed,
    asleepMinutes: asleep,
    stages: { deep, rem, core: withStages ? asleep - deep - rem : 0, awake: inBed - asleep },
    source: 'test',
  };
}
