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
import { allReaders, profileState } from './app-state.fake';
import { defaultProfile } from '../../profile/types';
import type { AppReaders } from './reads/app-readers';
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

/** The readers behind get_app_data: working, throwing a message that carries the canaries, or with no store configured. */
export function appReadersFor(mode: Mode, leaky: string): Partial<AppReaders> {
  if (mode === 'healthy') return allReaders();
  const profile = defaultProfile('UTC');
  const coverage = async () => ({ available: false, reason: leaky, unreadWorkouts: 0, referenceKey: null, range: null, mode: null });
  if (mode === 'unavailable') {
    return {
      databaseConfigured: () => false,
      labReports: async () => null,
      maps: async () => null,
      dashboard: async () => null,
      coverage,
      quality: async () => ({ state: 'unavailable', quality: null, silenced: [], detail: leaky }),
      profile: async () => profileState(profile, { stored: false, error: leaky }),
      preferences: async () => ({ ...(await allReaders().preferences!({} as NodeJS.ProcessEnv)), error: leaky }),
      pipeline: async () => fail(leaky),
    };
  }
  const boom = async () => fail(leaky);
  return { databaseConfigured: () => true, labReports: boom, goalSummary: boom, goalReport: boom, maps: boom, coverage: boom, quality: boom, pipeline: boom, profile: boom, preferences: boom, dashboard: boom };
}

export function accessFor(mode: Mode, data: HealthFixtures, c: Canaries): DataAccess {
  const training: () => Promise<TrainingData> = mode === 'throwing' ? async () => fail(c.leaky) : async () => trainingData(strengthSessions(data));
  return createDataAccess({ system: 'metric', refKey: REF, env: c.env, labSource: labs(mode, c.leaky), medicationLog: meds(mode, c.leaky), training, app: appReadersFor(mode, c.leaky) });
}

export function ctxFor(mode: Mode, data: HealthFixtures, routine: CapabilityContext['routine'], c: Canaries): CapabilityContext {
  return { system: 'metric', refKey: REF, tz: 'America/Chicago', env: c.env, access: accessFor(mode, data, c), routine, policy: ALLOW_ALL, app: appReadersFor(mode, c.leaky) };
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
  'labs.documents': {},
  'body.goal': {},
  'body.nutrition_adherence': { window: { lastDays: 30 } },
  'insights.current': {},
  'insights.reports': { kind: 'weekly', count: 2 },
  'activity.coverage': { window: { lastDays: 30 } },
  'activity.maps': {},
  'app.data_quality': {},
  'app.pipeline': {},
  'app.profile': {},
  'app.preferences': {},
  'app.briefing': {},
  'app.dashboard': {},
  'training.workout_template': { templateId: 'a' },
};

/** The arguments a model sends for a capability: get_app_data takes the capability and its params. */
export function toolArgs(cap: { id: string; tool: string }): Record<string, unknown> {
  return cap.tool === 'get_app_data' ? { capability: cap.id, params: ARGS[cap.id] } : ARGS[cap.id];
}
