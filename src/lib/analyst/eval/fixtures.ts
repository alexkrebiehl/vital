// ── Everything the offline evaluation asks about (synthetic, seeded) ─────────
//
// The seeded dataset (400 days, 420 workouts, sleep, blood pressure) plus nutrition,
// VO2 max and exercise minutes; three lab panels with LDL and A1c; sixty days of
// doses; strength sessions with a bench press; the app readers of the AN-D4 tests.
// No wall clock, no database, no health source, no model.

import { setActiveDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import type { HealthFixtures, MetricObservation } from '../../metrics/types';
import type { TrainingSession } from '../../workout-sources/types';
import { bodyDataset } from '../capabilities/app.fake';
import { allReaders } from '../capabilities/app-state.fake';
import { labSeries, labSource, obs } from '../capabilities/lab.fake';
import { records } from '../capabilities/medications.fake';
import { DEMO } from '../capabilities/test-context.fake';
import { REF, rng, strengthSessions, trainingData } from '../capabilities/test-dataset.fake';
import { createDataAccess, type DataAccess } from '../dataAccess';
import type { LabSourceInput } from '../labSnapshot';
import type { TrainingData } from '../../workout-sources/store';

const point = (day: string, qty: number, units: string): MetricObservation => ({ date: `${day}T15:00:00.000Z`, qty, units, source: 'test' });

/** The body dataset with VO2 max every third day and exercise minutes every day, for 120 days. */
export function evalDataset(): HealthFixtures {
  const base = bodyDataset(11);
  const r = rng(23);
  const days = Array.from({ length: 120 }, (_, i) => addDays(REF, -(119 - i)));
  return {
    ...base,
    metrics: {
      ...base.metrics,
      vo2max: days.filter((_, i) => i % 3 === 0).map(d => point(d, 38 + Math.round(r() * 60) / 10, 'mL/min·kg')),
      apple_exercise_time: days.map(d => point(d, 20 + Math.round(r() * 50), 'min')),
    },
  };
}

export function installEvalDataset(): HealthFixtures {
  const data = evalDataset();
  setActiveDataset(data, { mode: 'demo' });
  return data;
}

/** Three panels (10 Mar, 15 Jun, 29 Sep 2026): LDL and A1c on each. */
export const EVAL_LABS: LabSourceInput = labSource([
  labSeries('ldl', 'LDL cholesterol', 'Lipids', [obs('2026-03-10', 120), obs('2026-06-15', 95), obs('2026-09-29', 110)]),
  labSeries('a1c', 'Hemoglobin A1c', 'Metabolic', [obs('2026-03-10', 5.9, { unit: '%' }), obs('2026-06-15', 5.7, { unit: '%' }), obs('2026-09-29', 5.6, { unit: '%' })]),
]);

/** The strength workouts' sessions, each with a bench press that gets heavier. */
export function benchSessions(data: HealthFixtures): TrainingSession[] {
  return strengthSessions(data).map((s, i) => ({
    ...s,
    exercises: [...s.exercises, { sourceTemplateId: 'bp', name: 'Bench press', loadMeaning: 'added' as const, sets: [{ index: 0, kind: 'normal' as const, reps: 5, weightKg: 60 + (i % 20), rpe: 8 }] }],
  }));
}

export interface EvalWorld {
  data: HealthFixtures;
  access: DataAccess;
  training: TrainingData;
}

/** The dataset is installed (call resetToDemoDataset afterwards); the stores are in memory. */
export function evalWorld(): EvalWorld {
  const data = installEvalDataset();
  const training = trainingData(benchSessions(data));
  const access = createDataAccess({
    system: 'metric',
    refKey: REF,
    env: DEMO,
    labSource: async () => EVAL_LABS,
    medicationLog: async () => ({ available: true, reason: null, timezone: 'America/Chicago', records: records() }),
    training: async () => training,
    app: allReaders(),
  });
  return { data, access, training };
}
