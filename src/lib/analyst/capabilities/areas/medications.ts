// ── Capabilities: medications (SERVER ONLY) ─────────────

import type { Capability, Coverage } from '../types';
import { manifestEntry } from '../manifest';
import { readMedicationDoses, readMedicationSummary, DEFAULT_LIMIT, MAX_LIMIT } from '../reads/medications';
import { MEDICATIONS_COVERAGE } from '../reads/medications-select';

type Args = Record<string, unknown>;

const ABSENCE = ['no medication records', 'no doses logged', 'no dose records', 'not taking'];
const MIRRORS = { routes: ['GET /api/medications'], pages: ['/medications'] };

async function coverage(): Promise<Coverage> {
  return { ...MEDICATIONS_COVERAGE };
}

export const doses: Capability<Args, unknown> = {
  ...manifestEntry('medications.doses'),
  description:
    'Each logged medication dose in a window: day, local time, medication and dose as logged, and whether it was taken, skipped or unknown. Filter by name, page. A record of what was logged, not a treatment plan.',
  owner: 'medications-upstream',
  mirrors: MIRRORS,
  time: 'window',
  sizeClass: 'per-record',
  page: { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT },
  absenceTerms: ABSENCE,
  coverage,
  read: (args, ctx) => readMedicationDoses(args, ctx),
};

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('medications.summary'),
  description:
    'The medication log over a window, per medication: dose records, days, last day, taken, skipped or unknown. A record of what was logged, not a treatment plan.',
  owner: 'medications-upstream',
  mirrors: MIRRORS,
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ABSENCE,
  coverage,
  read: (args, ctx) => readMedicationSummary(args, ctx),
};
