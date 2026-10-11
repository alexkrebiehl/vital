// ── Capabilities: sleep (SERVER ONLY) ───────────────────

import type { Capability } from '../types';
import { manifestEntry } from '../manifest';
import { readSleepNights, readSleepSummary } from '../reads/sleep';
import { sleepCoverage } from '../reads/sleep-select';

type Args = Record<string, unknown>;

const ABSENCE = ['no sleep', 'no sleep data', 'no sleep records', 'no nights', 'not recorded'];
const MIRRORS = {
  pages: ['/sleep'],
  accessors: ['sleepSeries', 'sleepNightsWithStages', 'sleepCoverageSummary', 'hasSleepStages'],
  metrics: ['sleep_analysis', 'sleep_in_bed'],
};

export const nights: Capability<Args, unknown> = {
  ...manifestEntry('sleep.nights'),
  description:
    'Each night of sleep in a window: bedtime and wake time, time asleep and in bed, and the deep, core, REM and awake split. A night recorded only as time in bed has no time asleep and no stages. Sort to find the deepest or latest nights.',
  owner: 'dataset',
  mirrors: MIRRORS,
  time: 'window',
  sizeClass: 'per-record',
  page: { defaultLimit: 14, maxLimit: 31 },
  absenceTerms: ABSENCE,
  citesAs: ['sleep_analysis', 'sleep_in_bed'],
  coverage: sleepCoverage,
  read: (args, ctx) => readSleepNights(args, ctx),
};

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('sleep.summary'),
  description:
    'Sleep over a window in a few lines: nights, nights with stages, mean time asleep, in bed and each stage, by week or month, and the three longest and shortest nights. For a year of sleep.',
  owner: 'dataset',
  mirrors: MIRRORS,
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ABSENCE,
  citesAs: ['sleep_analysis', 'sleep_in_bed'],
  coverage: sleepCoverage,
  read: (args, ctx) => readSleepSummary(args, ctx),
};
