// ── Capabilities: the training plan's read tools (SERVER ONLY) ──
//
// The five reads that sit beside the plan's write tools. The write tools are not
// capabilities: the analyst stays read-only for health data, and the plan tools
// are the only writers (design §9.1).

import type { Capability } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough } from './legacy';

type Args = Record<string, unknown>;

const STRENGTH = ['no sessions', 'no strength sessions', 'no training logged', 'no exercises logged'];

async function unknownCoverage() {
  return { kind: 'unknown' as const, reason: 'training data is read from the connected workout source when asked for' };
}

export const progress: Capability<Args, unknown> = {
  ...manifestEntry('training.progress'),
  description: 'The active training plan evaluated against logged sessions: current phase, each path\'s stage and light, readiness, next session, adherence, deload and recovery.',
  owner: 'workout-sources',
  mirrors: {
    routes: ['GET /api/routine', 'GET /api/routine/[pathId]'],
    pages: ['/workouts/routine', '/workouts/routine/[pathId]', '/workouts/recovery'],
  },
  time: 'none',
  sizeClass: 'small',
  absenceTerms: ['no plan', 'no training plan', 'not tracked'],
  coverage: unknownCoverage,
  read: (args, ctx) => readThrough(progress)(args, ctx),
};

export const plan: Capability<Args, unknown> = {
  ...manifestEntry('training.plan'),
  description: 'The active plan document with its id and revision. Read it before changing it.',
  owner: 'config-store',
  mirrors: {},
  time: 'none',
  sizeClass: 'small',
  absenceTerms: ['no plan', 'no training plan'],
  coverage: unknownCoverage,
  read: (args, ctx) => readThrough(plan)(args, ctx),
};

export const sessions: Capability<Args, unknown> = {
  ...manifestEntry('training.sessions'),
  description: 'Logged strength sessions, newest first: date, title, exercises with working sets and notes. Optionally filtered by exercise name.',
  owner: 'workout-sources',
  mirrors: { routes: ['GET /api/workout-sources/sessions'] },
  time: 'window',
  sizeClass: 'per-record',
  page: { defaultLimit: 40, maxLimit: 40 },
  absenceTerms: STRENGTH,
  coverage: unknownCoverage,
  read: (args, ctx) => readThrough(sessions)(args, ctx),
};

export const exerciseTemplates: Capability<Args, unknown> = {
  ...manifestEntry('training.exercise_templates'),
  description: 'Search the exercise catalogue by name, for exact names and template ids in stage match rules.',
  owner: 'workout-sources',
  mirrors: {},
  time: 'none',
  sizeClass: 'per-record',
  page: { defaultLimit: 20, maxLimit: 20 },
  absenceTerms: ['no matching exercise', 'not in the catalogue'],
  coverage: unknownCoverage,
  read: (args, ctx) => readThrough(exerciseTemplates)(args, ctx),
};

export const referencePlans: Capability<Args, unknown> = {
  ...manifestEntry('training.reference_plans'),
  description: 'A complete example plan to show the expected shape. Examples, not defaults.',
  owner: 'config-store',
  mirrors: {},
  time: 'none',
  sizeClass: 'small',
  absenceTerms: [],
  coverage: unknownCoverage,
  read: (args, ctx) => readThrough(referencePlans)(args, ctx),
};
