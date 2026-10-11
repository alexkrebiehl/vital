// ── Capabilities: insights and reports (SERVER ONLY) ────────────────────────

import { manifestEntry } from '../manifest';
import { computedCoverage, NO_PARAMS } from '../reads/app-common';
import { MAX_REPORTS, readInsights, readReports } from '../reads/app-insights';
import type { Capability } from '../types';

type Args = Record<string, unknown>;

export const current: Capability<Args, unknown> = {
  ...manifestEntry('insights.current'),
  description:
    'The insights the app can support today: changes against the week before and associations between metrics, each with its evidence and a caveat. An insight exists only when there are enough observations; association is never cause.',
  owner: 'computed',
  mirrors: { pages: ['/insights', '/'] },
  time: 'none',
  sizeClass: 'small',
  absenceTerms: ['no insights', 'nothing notable', 'no changes'],
  params: NO_PARAMS,
  coverage: computedCoverage('insights are computed from the data when asked for'),
  read: (args, ctx) => readInsights(args, ctx),
};

export const reports: Capability<Args, unknown> = {
  ...manifestEntry('insights.reports'),
  description:
    'The weekly or monthly reports the Insights page shows, most recent first: for each period its coverage, a short account and one line per metric with its change against the period before. Complete periods only.',
  owner: 'computed',
  mirrors: {},
  time: 'none',
  sizeClass: 'per-record',
  page: { defaultLimit: MAX_REPORTS, maxLimit: MAX_REPORTS },
  absenceTerms: ['no report', 'no weekly report', 'no monthly report'],
  params: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['weekly', 'monthly'] },
      count: { type: 'integer', minimum: 1, maximum: MAX_REPORTS, description: 'How many periods (default 4).' },
      offset: { type: 'integer', minimum: 0, description: 'Use page.nextOffset.' },
    },
    additionalProperties: false,
  },
  coverage: computedCoverage('reports are computed from the data when asked for'),
  read: (args, ctx) => readReports(args, ctx),
};
