// ── Capabilities: lab results (SERVER ONLY) ─────────────

import type { Capability, CapabilityContext, Coverage } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough, type SourceDown } from './legacy';
import { scrubForModel } from '../../scrub';

type Args = Record<string, unknown>;

/** First and last observation day over every stored series; read from the per-question lab source. */
export async function labsCoverage(ctx: CapabilityContext): Promise<Coverage> {
  let lab;
  try {
    lab = await ctx.access.labSource();
  } catch (error) {
    return { kind: 'unavailable', reason: scrubForModel(error instanceof Error ? error.message : 'The lab results could not be read.') };
  }
  if (!lab.available) return { kind: 'unavailable', reason: scrubForModel(lab.reason ?? 'The lab results could not be read.') };
  const days = lab.series.flatMap(s => s.points.map(p => p.on)).sort();
  return { kind: 'known', first: days[0] ?? null, last: days[days.length - 1] ?? null, count: lab.totalObservations, unit: 'results' };
}

const labDown: SourceDown = async ctx => !(await ctx.access.labSource()).available;

const ABSENCE = ['no lab results', 'no labs', 'no blood work', 'no results on file', 'not tested'];

export const series: Capability<Args, unknown> = {
  ...manifestEntry('labs.series'),
  description: 'Stored lab results by analyte or category, optionally limited to a date window: latest value, unit, date, reference interval, status and change, with history on request. Documents (dates, lab names) are not here.',
  owner: 'lab-store',
  mirrors: { routes: ['GET /api/lab/summary'], pages: ['/lab', '/lab/[analyteKey]'] },
  time: 'none',
  sizeClass: 'per-series',
  absenceTerms: ABSENCE,
  coverage: labsCoverage,
  read: (args, ctx) => readThrough(series, labDown)(args, ctx),
};

export const compare: Capability<Args, unknown> = {
  ...manifestEntry('labs.compare'),
  description: 'Two lab panel dates compared series by series, with the change and the status on each date.',
  owner: 'lab-store',
  mirrors: {},
  time: 'none',
  sizeClass: 'per-record',
  absenceTerms: ABSENCE,
  coverage: labsCoverage,
  read: (args, ctx) => readThrough(compare, labDown)(args, ctx),
};
