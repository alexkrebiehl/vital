// ── Sources for the privacy test ────────────────────────────────────────────
//
// Lab store, medication log and strength source that work, throw, or report
// themselves unavailable, with failure messages that carry the canaries the way a
// real HTTP failure echoes a header, a URL or a key.

import { addDays } from '../../analytics/windows';
import { toMedicationRecord } from '../../adapters/medications';
import { createDataAccess, type DataAccess } from '../dataAccess';
import type { MedicationLogReader } from '../medicationLog';
import type { LabSourceInput } from '../labSnapshot';
import type { TrainingData } from '../../workout-sources/store';
import { DATED_LABS } from './lab.fake';
import { REF, strengthSessions, trainingData } from './test-dataset.fake';
import type { HealthFixtures } from '../../metrics/types';
import { ALLOW_ALL, type CapabilityContext } from './types';

/** The canary values of a test run, made in the test file (a variable's name is only ever written there). */
export interface Canaries {
  /** The question's environment: demo data plus every credential variable set to its canary. */
  env: NodeJS.ProcessEnv;
  /** What a failing source says: it carries every canary. */
  leaky: string;
}

export type Mode = 'healthy' | 'throwing' | 'unavailable';

const fail = (message: string): never => {
  throw new Error(message);
};

const labs = (mode: Mode, leaky: string): (() => Promise<LabSourceInput>) =>
  mode === 'throwing'
    ? async () => fail(leaky)
    : mode === 'unavailable'
      ? async () => ({ available: false, reason: leaky, documents: 0, totalObservations: 0, collisions: 0, series: [] })
      : async () => DATED_LABS;

const meds = (mode: Mode, leaky: string): MedicationLogReader =>
  mode === 'throwing'
    ? async () => fail(leaky)
    : mode === 'unavailable'
      ? async () => ({ available: false, reason: leaky, timezone: 'UTC', records: [] })
      : async () => ({
          available: true,
          reason: null,
          timezone: 'UTC',
          records: [toMedicationRecord({ _id: 'm1', displayText: 'Carvedilol 6.25mg Oral tablet', scheduledDate: `${addDays(REF, -1)}T13:00:00.000Z`, status: 'Taken' })],
        });

export function accessFor(mode: Mode, data: HealthFixtures, c: Canaries): DataAccess {
  const training: () => Promise<TrainingData> = mode === 'throwing' ? async () => fail(c.leaky) : async () => trainingData(strengthSessions(data));
  return createDataAccess({ system: 'metric', refKey: REF, env: c.env, labSource: labs(mode, c.leaky), medicationLog: meds(mode, c.leaky), training });
}

export function ctxFor(mode: Mode, data: HealthFixtures, routine: CapabilityContext['routine'], c: Canaries): CapabilityContext {
  return { system: 'metric', refKey: REF, tz: 'America/Chicago', env: c.env, access: accessFor(mode, data, c), routine, policy: ALLOW_ALL };
}

/** One representative call for every capability id. */
export const ARGS: Record<string, Record<string, unknown>> = {
  'metrics.summary': { metrics: ['resting_heart_rate'], days: 30 },
  'metrics.compare': { metric: 'step_count', aStart: '2026-09-01', aEnd: '2026-09-07', bStart: '2026-09-10', bEnd: '2026-09-16' },
  'metrics.series': { metrics: ['resting_heart_rate'], window: { lastDays: 30 } },
  'metrics.relationship': { x: 'resting_heart_rate', y: 'heart_rate_variability', days: 90 },
  'workouts.sessions': { window: { lastDays: 30 }, detail: true },
  'workouts.summary': { window: { lastDays: 30 }, view: 'summary' },
  'sleep.nights': { window: { lastDays: 14 } },
  'sleep.summary': { window: { lastDays: 90 }, view: 'summary' },
  'heart.blood_pressure': { window: { lastDays: 90 } },
  'labs.series': { analytes: ['ldl', 'hemoglobin'], history: true },
  'labs.compare': { dateA: '2026-03-10', dateB: '2026-09-29' },
  'medications.summary': { window: { lastDays: 30 } },
  'medications.doses': { window: { lastDays: 30 }, view: 'doses' },
  'training.progress': {},
  'training.plan': {},
  'training.sessions': { days: 60 },
  'training.exercise_templates': { query: 'squat' },
  'training.reference_plans': {},
};
