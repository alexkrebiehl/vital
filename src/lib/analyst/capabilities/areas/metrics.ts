// ── Capabilities: metrics (SERVER ONLY) ─────────────────

import { availableMetricIds, coverageFor, isPairedMetric } from '../../../adapters/dataset';
import { getAllMetrics } from '../../../metrics/registry';
import type { Capability, CapabilityContext, Coverage } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough } from './legacy';
import { readMetricSeries } from '../reads/metric-series';

type Args = Record<string, unknown>;

/** Every registered metric that is a single number per day; blood pressure is a pair and has its own capability. */
export function singleNumberMetricIds(): string[] {
  return getAllMetrics().map(m => m.id).filter(id => !isPairedMetric(id));
}

/** The span of the installed dataset's metrics and how many have data. Live, never cached. */
export async function metricsCoverage(_ctx: CapabilityContext): Promise<Coverage> {
  const facts = availableMetricIds().map(id => coverageFor(id)).filter((f): f is NonNullable<typeof f> => f !== undefined);
  if (facts.length === 0) return { kind: 'known', first: null, last: null, count: 0, unit: 'metrics' };
  const first = facts.map(f => f.firstObservation).sort()[0];
  const last = facts.map(f => f.lastObservation).sort().reverse()[0];
  return { kind: 'known', first, last, count: facts.length, unit: 'metrics' };
}

const ABSENCE = ['no data', 'no records', 'not recorded', 'no readings', 'nothing recorded'];

export const series: Capability<Args, unknown> = {
  ...manifestEntry('metrics.series'),
  description:
    'One to three daily health metrics (heart, activity, body, nutrition, sleep minutes) over any window: a summary, the daily, weekly or monthly points, and the change against the window before or one you name. Blood pressure and sleep stages are not here.',
  owner: 'dataset',
  mirrors: {
    pages: ['/metric/[metricId]', '/trends'],
    accessors: ['seriesFor', 'metricSeries', 'metricHasData', 'unavailableReasonFor', 'isPairedMetric', 'coverageFor', 'availableMetricIds'],
    metrics: singleNumberMetricIds(),
  },
  time: 'window',
  sizeClass: 'per-series',
  page: { defaultLimit: 92, maxLimit: 92 },
  absenceTerms: ABSENCE,
  citesAs: [],
  coverage: metricsCoverage,
  read: (args, ctx) => readMetricSeries(args, ctx),
};

export const relationship: Capability<Args, unknown> = {
  ...manifestEntry('metrics.relationship'),
  description: 'How two metrics move together over a period, as an association with its strength and sample size. Never a cause.',
  owner: 'computed',
  mirrors: { pages: ['/trends'], accessors: ['seriesFor'], metrics: singleNumberMetricIds() },
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ABSENCE,
  coverage: metricsCoverage,
  read: (args, ctx) => readThrough(relationship)(args, ctx),
};
