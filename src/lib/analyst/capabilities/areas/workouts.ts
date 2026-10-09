// ── Capabilities: workouts (SERVER ONLY) ────────────────

import { workoutList } from '../../../adapters/dataset';
import { workoutDayKey } from '../../../analytics/workouts';
import type { Capability, CapabilityContext, Coverage } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough } from './legacy';

type Args = Record<string, unknown>;

/** The recorded sessions of the installed dataset: first and last day, and how many. */
export async function workoutsCoverage(_ctx: CapabilityContext): Promise<Coverage> {
  const days = workoutList().map(w => workoutDayKey(w)).sort();
  return { kind: 'known', first: days[0] ?? null, last: days[days.length - 1] ?? null, count: days.length, unit: 'sessions' };
}

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('workouts.summary'),
  description: 'The health-source workout log rolled up over the last N days: sessions, per week, minutes, calories, a count by type. Individual sessions are not available from it.',
  owner: 'dataset',
  mirrors: { pages: ['/workouts'], accessors: ['workoutList'] },
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ['no workouts', 'no workout records', 'no sessions', 'did not work out'],
  coverage: workoutsCoverage,
  read: (args, ctx) => readThrough(summary)(args, ctx),
};
