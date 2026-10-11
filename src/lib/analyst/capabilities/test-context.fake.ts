// ── A capability context for tests, over the synthetic dataset ──────────────
//
// Nothing here reads Postgres, a health source or a model: the lab and medication
// readers are stubs, and the strength sessions are whatever the test hands in.

import { expect } from 'vitest';
import { createDataAccess } from '../dataAccess';
import type { LabSourceInput } from '../labSnapshot';
import { ALLOW_ALL, type CapabilityContext } from './types';
import { REF } from './test-dataset.fake';
import { trainingData } from './test-dataset.fake';
import type { TrainingData } from '../../workout-sources/store';
import { isErrorStatus, type Envelope } from './envelope';
import { assertNumberRule } from './number-rule';

export const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;
const NO_LABS: LabSourceInput = { available: true, reason: null, documents: 0, totalObservations: 0, collisions: 0, series: [] };

export function testCtx(over: Partial<CapabilityContext> = {}, training: () => Promise<TrainingData> = async () => trainingData([])): CapabilityContext {
  const access = createDataAccess({
    system: 'metric',
    refKey: REF,
    env: DEMO,
    labSource: async () => NO_LABS,
    training,
  });
  return { system: 'metric', refKey: REF, tz: 'America/Chicago', env: DEMO, access, routine: { env: DEMO }, policy: ALLOW_ALL, ...over };
}

/** The envelope's JSON size: what the model is sent. */
export const sizeOf = (env: Envelope<unknown>): number => JSON.stringify(env).length;

/** An ok or empty envelope whose data obeys the number rule. */
export function expectClean(env: Envelope<unknown>): void {
  expect(isErrorStatus(env.status), JSON.stringify(env).slice(0, 300)).toBe(false);
  assertNumberRule(env);
}
