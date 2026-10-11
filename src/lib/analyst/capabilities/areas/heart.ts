// ── Capabilities: heart (SERVER ONLY) ───────────────────

import type { Capability } from '../types';
import { manifestEntry } from '../manifest';
import { bloodPressureCoverage, readBloodPressure } from '../reads/blood-pressure';

type Args = Record<string, unknown>;

export const bloodPressure: Capability<Args, unknown> = {
  ...manifestEntry('heart.blood_pressure'),
  description:
    'Blood pressure readings in a window, each as a systolic/diastolic pair, flagged against the 120/80 reference threshold, or summarised with the change against the window before. A reference threshold, never a diagnosis.',
  owner: 'dataset',
  mirrors: { pages: ['/health'], accessors: ['bloodPressureSeries'], metrics: ['blood_pressure'] },
  time: 'window',
  sizeClass: 'per-record',
  page: { defaultLimit: 50, maxLimit: 100 },
  absenceTerms: ['no blood pressure', 'no readings', 'no blood pressure readings', 'not recorded'],
  citesAs: ['blood_pressure'],
  coverage: bloodPressureCoverage,
  read: (args, ctx) => readBloodPressure(args, ctx),
};
