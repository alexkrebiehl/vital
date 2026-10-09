// ── Capabilities: the body goal (SERVER ONLY) ───────────────────────────────

import { manifestEntry } from '../manifest';
import { foodLogCoverage, readBodyGoal, readNutritionAdherence, ADHERENCE_LIMITS } from '../reads/app-body';
import { NO_PARAMS, storedCoverage } from '../reads/app-common';
import { WINDOW_SCHEMA } from '../window';
import type { Capability } from '../types';

type Args = Record<string, unknown>;

export const goal: Capability<Args, unknown> = {
  ...manifestEntry('body.goal'),
  description:
    'The body goal and where the reader stands against it: target, phase, progress, weight trend and pace, arrival projection (never a deadline), maintenance estimate, food-log status and the nutrition targets. All figures are text in the reader\'s units.',
  owner: 'config-store',
  mirrors: { routes: ['GET /api/body-goal'], pages: ['/body'] },
  time: 'none',
  sizeClass: 'small',
  absenceTerms: ['no goal', 'no body goal', 'not set a goal', 'no target weight'],
  params: NO_PARAMS,
  coverage: storedCoverage('the goal is read when asked for'),
  read: (args, ctx) => readBodyGoal(args, ctx),
};

export const nutritionAdherence: Capability<Args, unknown> = {
  ...manifestEntry('body.nutrition_adherence'),
  description:
    'Each logged day of food in a window against the goal\'s calorie and protein targets, as the Nutrition page judges it: calories and protein, on target, OK or off. Complete days are counted, partly logged days are shown but left out of the counts, unlogged days are not rows.',
  owner: 'computed',
  mirrors: { pages: ['/body/nutrition'] },
  time: 'window',
  sizeClass: 'per-day',
  page: ADHERENCE_LIMITS,
  absenceTerms: ['no food log', 'no food logged', 'nothing logged', 'no nutrition data', 'not logging'],
  params: {
    type: 'object',
    properties: {
      window: { ...WINDOW_SCHEMA, description: 'Default: the four weeks ending yesterday.' },
      limit: { type: 'integer', minimum: 1, maximum: ADHERENCE_LIMITS.maxLimit },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  coverage: foodLogCoverage,
  read: (args, ctx) => readNutritionAdherence(args, ctx),
};
