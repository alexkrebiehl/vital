// ── Capabilities: metrics (SERVER ONLY) ─────────────────

import { availableMetricIds, coverageFor, isPairedMetric } from '../../../adapters/dataset';
import { getAllMetrics } from '../../../metrics/registry';
import type { Capability, CapabilityContext, Coverage } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough } from './legacy';

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

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('metrics.summary'),
  description: 'Daily health metrics (heart, sleep minutes, activity, body, nutrition) summarised over the last N days against the N before. Holds one number per day; blood pressure and sleep stages are not here.',
  owner: 'dataset',
  mirrors: {
    pages: ['/metric/[metricId]'],
    accessors: ['seriesFor', 'metricHasData', 'unavailableReasonFor', 'isPairedMetric', 'coverageFor', 'availableMetricIds'],
    metrics: singleNumberMetricIds(),
  },
  time: 'window',
  sizeClass: 'per-series',
  absenceTerms: ABSENCE,
  coverage: metricsCoverage,
  read: (args, ctx) => readThrough(summary)(args, ctx),
};

export const compare: Capability<Args, unknown> = {
  ...manifestEntry('metrics.compare'),
  description: 'The same metrics over two chosen periods, side by side, with the change between them. For a question about a specific past period.',
  owner: 'dataset',
  mirrors: { pages: ['/trends'], accessors: ['seriesFor'], metrics: singleNumberMetricIds() },
  time: 'window',
  sizeClass: 'per-series',
  absenceTerms: ABSENCE,
  coverage: metricsCoverage,
  read: (args, ctx) => readThrough(compare)(args, ctx),
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
