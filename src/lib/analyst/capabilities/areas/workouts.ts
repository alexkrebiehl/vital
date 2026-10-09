// ── Capabilities: workouts (SERVER ONLY) ────────────────

import type { Capability } from '../types';
import { manifestEntry } from '../manifest';
import { readWorkoutSessions } from '../reads/workouts-sessions';
import { readWorkoutSummary } from '../reads/workouts-summary';
import { workoutsCoverage } from '../reads/workouts-select';

export { workoutsCoverage };

type Args = Record<string, unknown>;

const ABSENCE = ['no workouts', 'no workout records', 'no sessions', 'did not work out'];

export const sessions: Capability<Args, unknown> = {
  ...manifestEntry('workouts.sessions'),
  description:
    'Each recorded workout in a window: date, start and end time, type, duration, and distance, calories and heart rate when recorded. Filter by type, sort, page; with detail, the exercises of the matching strength session.',
  owner: 'dataset',
  mirrors: { routes: ['GET /api/workout-sources/match'], pages: ['/workouts', '/workouts/all'], accessors: ['workoutList'] },
  time: 'window',
  sizeClass: 'per-record',
  page: { defaultLimit: 20, maxLimit: 25 },
  absenceTerms: ABSENCE,
  coverage: workoutsCoverage,
  read: (args, ctx) => readWorkoutSessions(args, ctx),
};

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('workouts.summary'),
  description:
    'The workout log rolled up over a window: sessions, per week, time as h:mm, calories, distance, a count by type and by month, and the latest three sessions. The types present are always listed.',
  owner: 'dataset',
  mirrors: { pages: ['/workouts'], accessors: ['workoutList'] },
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ABSENCE,
  coverage: workoutsCoverage,
  read: (args, ctx) => readWorkoutSummary(args, ctx),
};
