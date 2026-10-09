// ── Capabilities: where the workouts went (SERVER ONLY) ─────────────────────

import { manifestEntry } from '../manifest';
import { NO_PARAMS, storedCoverage } from '../reads/app-common';
import { COVERAGE_DEFAULT_DAYS, mapsCoverage, readActivityCoverage, readActivityMaps } from '../reads/app-activity';
import { WINDOW_SCHEMA } from '../window';
import type { Capability } from '../types';

type Args = Record<string, unknown>;

export const coverage: Capability<Args, unknown> = {
  ...manifestEntry('activity.coverage'),
  description:
    'Where the workouts went, by saved map area, over a window: workouts, distance and time in each area, how much of the ground covered was new, and the same by activity type. Area-level totals only, never a route or a coordinate.',
  owner: 'computed',
  mirrors: { routes: ['GET /api/activity-coverage'], pages: ['/activity'] },
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ['no activity', 'no workouts there', 'nowhere', 'no routes'],
  params: {
    type: 'object',
    properties: { window: { ...WINDOW_SCHEMA, description: `Default: the last ${COVERAGE_DEFAULT_DAYS} days.` } },
    additionalProperties: false,
  },
  coverage: storedCoverage('coverage is read when asked for'),
  read: (args, ctx) => readActivityCoverage(args, ctx),
};

export const maps: Capability<Args, unknown> = {
  ...manifestEntry('activity.maps'),
  description: 'The map areas the reader saved, by name and rough size. Configuration only: no place, route or workout.',
  owner: 'config-store',
  mirrors: { routes: ['GET /api/activity-maps'], pages: ['/activity/maps'] },
  time: 'none',
  sizeClass: 'small',
  absenceTerms: ['no maps', 'no saved areas', 'no map areas'],
  params: NO_PARAMS,
  coverage: mapsCoverage,
  read: (args, ctx) => readActivityMaps(args, ctx),
};
