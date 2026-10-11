// ── A medication log for tests: seeded, synthetic, no source behind it ──────

import { toMedicationRecord, type MedicationRecord } from '../../adapters/medications';
import { addDays } from '../../analytics/windows';
import { createDataAccess, type DataAccessOptions } from '../dataAccess';
import { DEMO } from './test-context.fake';
import { REF, trainingData } from './test-dataset.fake';
import { ALLOW_ALL, type CapabilityContext } from './types';
import { capabilityById } from './registry';

export const TZ = 'America/Chicago';
const NO_LABS = { available: true, reason: null, documents: 0, totalObservations: 0, collisions: 0, series: [] };

/** 60 days of two medications (08:00 and 20:00 Chicago), every sixth dose skipped, plus one undated record. */
export function records(): MedicationRecord[] {
  const out: MedicationRecord[] = [];
  for (let i = 0; i < 60; i++) {
    const day = addDays(REF, -i);
    const status = i % 6 === 5 ? 'Skipped' : i % 11 === 10 ? 'Mystery' : 'Taken';
    out.push(toMedicationRecord({ _id: `a${i}`, displayText: 'Carvedilol 6.25mg Oral tablet', scheduledDate: `${day}T13:00:00.000Z`, status, dosage: 1 }, TZ));
    out.push(toMedicationRecord({ _id: `b${i}`, displayText: 'Losartan Potassium 50mg', scheduledDate: `${addDays(day, 1)}T02:00:00.000Z`, status: 'Taken' }, TZ));
  }
  out.push(toMedicationRecord({ _id: 'u', displayText: 'Vitamin D 2000 IU', scheduledDate: null, status: 'Taken' }, TZ));
  return out;
}

export function ctxWith(log: DataAccessOptions['medicationLog']): CapabilityContext {
  const access = createDataAccess({ system: 'metric', refKey: REF, env: DEMO, labSource: async () => NO_LABS, training: async () => trainingData([]), medicationLog: log });
  return { system: 'metric', refKey: REF, tz: TZ, env: DEMO, access, routine: { env: DEMO }, policy: ALLOW_ALL };
}

export const live = (rs: MedicationRecord[] = records()) => ctxWith(async () => ({ available: true, reason: null, timezone: TZ, records: rs }));
export const doses = (args: Record<string, unknown>, ctx = live()) => capabilityById('medications.doses')!.read(args, ctx);
export const summary = (args: Record<string, unknown>, ctx = live()) => capabilityById('medications.summary')!.read(args, ctx);
