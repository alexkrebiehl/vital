// ── A seeded synthetic dataset for the analyst capability tests ─────────────
//
// 400 days ending on REF, 420 workouts of five types, nights with and without
// stages, blood-pressure pairs (one with a missing half), and sum metrics whose
// reference day is partial. Seeded: no wall clock, no randomness outside `rng`.
// `installTestDataset` goes through `setActiveDataset`; call `resetToDemoDataset`
// in afterEach. Assertions about values never read the committed fixtures.

import { FIXTURES, setActiveDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import type { BloodPressureObservation, HealthFixtures, MetricObservation, SleepObservation, WorkoutRecord } from '../../metrics/types';
import type { TrainingData } from '../../workout-sources/store';
import type { TrainingSession } from '../../workout-sources/types';

/** The synthetic reference day: "today" in these datasets. */
export const REF = '2026-10-08';
export const DAYS = 400;
export const WORKOUT_COUNT = 420;
export const WORKOUT_TYPES = ['Running', 'Cycling', 'Walking', 'Strength Training', 'Yoga'] as const;

/** mulberry32: a small seeded generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayAt = (i: number): string => addDays(REF, -(DAYS - 1 - i));
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

function metricSeries(r: () => number, lo: number, hi: number, partialToday?: number): MetricObservation[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const day = dayAt(i);
    const today = i === DAYS - 1;
    return {
      date: `${day}T18:00:00.000Z`,
      qty: today && partialToday !== undefined ? partialToday : int(r, lo, hi),
      units: '',
      source: 'test',
      ...(today && partialToday !== undefined ? { partial: true } : {}),
    };
  });
}

/** Every seventh night is an in-bed-only record: no stage split, so no time asleep. */
function nights(r: () => number): SleepObservation[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const day = dayAt(i);
    const inBed = int(r, 400, 520);
    const staged = i % 7 !== 3;
    const asleep = staged ? inBed - int(r, 20, 60) : 0;
    const deep = staged ? Math.round(asleep * 0.2) : 0;
    const rem = staged ? Math.round(asleep * 0.25) : 0;
    const bed = Date.parse(`${addDays(day, -1)}T04:30:00.000Z`) + int(r, 0, 90) * 60_000;
    return {
      date: day,
      bedtime: new Date(bed).toISOString(),
      wakeTime: new Date(bed + inBed * 60_000).toISOString(),
      durationMinutes: inBed,
      inBedMinutes: inBed,
      asleepMinutes: asleep,
      stages: { deep, rem, core: staged ? asleep - deep - rem : 0, awake: inBed - asleep },
      source: 'test',
    };
  });
}

/** 60 readings over the last 120 days. The 5th reading is missing its systolic half. */
function pressures(r: () => number): BloodPressureObservation[] {
  return Array.from({ length: 60 }, (_, k) => ({
    date: `${addDays(REF, -119 + k * 2)}T14:00:00.000Z`,
    systolic: k === 4 ? Number.NaN : int(r, 108, 142),
    diastolic: int(r, 66, 92),
    units: 'mmHg',
    source: 'test',
  }));
}

/** 420 workouts: one a day, plus a second on twenty days. */
export function workouts(r: () => number): WorkoutRecord[] {
  const out: WorkoutRecord[] = [];
  const add = (day: string, n: number, second: boolean) => {
    const type = WORKOUT_TYPES[(n + int(r, 0, 4)) % WORKOUT_TYPES.length];
    const minutes = int(r, 20, 90);
    const start = Date.parse(`${day}T${second ? '23' : '13'}:00:00.000Z`);
    const moves = type === 'Running' || type === 'Cycling' || type === 'Walking';
    out.push({
      id: `w-${String(out.length + 1).padStart(4, '0')}`,
      workout_type: type,
      start_time: new Date(start).toISOString(),
      end_time: new Date(start + minutes * 60_000).toISOString(),
      duration_minutes: minutes,
      calories_burned: out.length % 17 === 0 ? null : int(r, 120, 700),
      source: 'test',
      ...(moves ? { distance_km: Math.round(int(r, 20, 150)) / 10 } : {}),
      ...(out.length % 3 !== 0 ? { avg_heart_rate: int(r, 110, 150), max_heart_rate: int(r, 155, 185) } : {}),
    });
  };
  for (let i = 0; i < DAYS; i++) add(dayAt(i), i, false);
  for (let k = 0; k < WORKOUT_COUNT - DAYS; k++) add(dayAt(k * 19 + 3), k, true);
  return out.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function testDataset(seed = 7): HealthFixtures {
  const r = rng(seed);
  const metrics: HealthFixtures['metrics'] = {
    step_count: metricSeries(r, 3000, 14000, 1200),
    active_energy: metricSeries(r, 200, 900, 90),
    resting_heart_rate: metricSeries(r, 52, 66),
    heart_rate_variability: metricSeries(r, 30, 80),
    sleep_analysis: nights(r),
    blood_pressure: pressures(r),
  };
  const coverage: HealthFixtures['coverage'] = {};
  for (const [id, series] of Object.entries(metrics)) {
    const first = (series[0] as { date: string }).date;
    const last = (series[series.length - 1] as { date: string }).date;
    coverage[id] = { firstObservation: first, lastObservation: last, observedDays: series.length, expectedDays: DAYS, samplingFrequency: 'daily', sourceNames: ['test'] };
  }
  return {
    ...FIXTURES,
    referenceDate: `${REF}T18:00:00.000Z`,
    windowStart: `${dayAt(0)}T06:00:00.000Z`,
    windowEnd: `${REF}T18:00:00.000Z`,
    days: DAYS,
    timezone: 'America/Chicago',
    metrics,
    workouts: workouts(r),
    coverage,
  };
}

export function installTestDataset(seed = 7): HealthFixtures {
  const data = testDataset(seed);
  setActiveDataset(data, { mode: 'demo' });
  return data;
}

/** One strength session for every second 'Strength Training' workout, on the same interval (so it matches). */
export function strengthSessions(data: HealthFixtures): TrainingSession[] {
  return data.workouts
    .filter(w => w.workout_type === 'Strength Training')
    .filter((_, i) => i % 2 === 0)
    .map((w, i) => ({
      id: `test:${i}`,
      sourceId: 'test',
      title: `Session ${i + 1}`,
      startTime: w.start_time,
      endTime: w.end_time,
      exercises: [
        {
          sourceTemplateId: 'sq',
          name: 'Back squat',
          loadMeaning: 'added' as const,
          sets: [
            { index: 0, kind: 'warmup' as const, reps: 10, weightKg: 20 },
            { index: 1, kind: 'normal' as const, reps: 5, weightKg: 80, rpe: 8 },
          ],
        },
        { sourceTemplateId: null, name: 'Plank', loadMeaning: 'none' as const, sets: [{ index: 0, kind: 'normal' as const, durationS: 60 }] },
      ],
    }));
}

export function trainingData(sessions: TrainingSession[]): TrainingData {
  return { origin: 'demo', sessions, statuses: [] };
}
