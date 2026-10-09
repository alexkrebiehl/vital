// ── Blood pressure (SERVER ONLY) ────────────────────────
//
// Readings are pairs: systolic and diastolic, always together, printed through the
// registry's pair formatter. A reading missing either number is not in
// `bloodPressureSeries()` and is never shown as half a pair. 120/80 mmHg is a
// reference threshold, not a diagnosis, and the result never says otherwise.

import { bloodPressureSeries } from '../../../adapters/dataset';
import {
  BP_REFERENCE_THRESHOLD,
  bloodPressureBaseline,
  bloodPressureChange,
  bloodPressureInWindow,
  bloodPressureStats,
  isAboveBloodPressureReference,
} from '../../../analytics/bloodPressure';
import { diffDays, makeWindow, previousWindow } from '../../../analytics/windows';
import { formatBloodPressure, formatBloodPressureChange } from '../../../metrics/format';
import type { BloodPressureObservation } from '../../../metrics/types';
import { ok, pageRows } from '../envelope';
import { manifestEntry } from '../manifest';
import type { CapabilityContext, Coverage } from '../types';
import { asWindow, choiceProblem, emptyWindow, guarded, pagingOf, problemsOf, spanOf, windowOf, type Args, type Read } from './common';

const entry = () => manifestEntry('heart.blood_pressure');
const VIEWS = ['readings', 'summary'] as const;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const MAX_CHARS = 9_500;

const NOTE =
  'Above the reference threshold is not a diagnosis, and a threshold is not specific to one person. Each reading is a pair; the figures here are never one number standing for blood pressure.';

export async function bloodPressureCoverage(_ctx?: CapabilityContext): Promise<Coverage> {
  return spanOf(bloodPressureSeries().map(r => r.date), 'readings');
}

export function readBloodPressure(args: Args, ctx: CapabilityContext): Promise<Read> {
  return guarded(entry(), ctx, async () => {
    const problems = choiceProblem('view', args.view, VIEWS);
    if (args.aboveReferenceOnly !== undefined && typeof args.aboveReferenceOnly !== 'boolean') problems.push('aboveReferenceOnly must be true or false.');
    const paging = pagingOf(args, DEFAULT_LIMIT, MAX_LIMIT);
    if (!paging.ok) problems.push(...paging.problems);
    const win = windowOf(args, ctx, 30);
    if (!win.ok) problems.push(...win.problems);
    if (problems.length || !paging.ok || !win.ok) return problemsOf(entry(), problems);

    const w = win.window;
    const dayWin = makeWindow(w.start, w.end, '');
    const all = bloodPressureSeries();
    const inWin = bloodPressureInWindow(all, dayWin);
    if (inWin.length === 0) return emptyWindow(entry(), w, await bloodPressureCoverage(ctx));

    const above = args.aboveReferenceOnly === true;
    const chosen = above ? inWin.filter(isAboveBloodPressureReference) : inWin;
    ctx.access.fetched.citable.add('blood_pressure');
    ctx.access.fetched.recordsRead += chosen.length;
    ctx.access.fetched.log.push(`blood pressure ${w.start}..${w.end}`);

    if (args.view === 'summary') return ok(entry(), summaryOf(chosen, all, w, dayWin, ctx, above), { window: asWindow(w) });

    const render = (r: BloodPressureObservation) => ({
      day: r.date,
      systolic: r.systolic,
      diastolic: r.diastolic,
      display: formatBloodPressure(r.systolic, r.diastolic, ctx.system),
      aboveReference: isAboveBloodPressureReference(r),
    });
    const newestFirst = [...chosen].reverse();
    const { rows, page } = pageRows(newestFirst, { limit: paging.paging.limit, offset: paging.paging.offset, maxChars: MAX_CHARS, render });
    return ok(entry(), { readings: rows, referenceThreshold: formatBloodPressure(BP_REFERENCE_THRESHOLD.systolic, BP_REFERENCE_THRESHOLD.diastolic, ctx.system), note: NOTE }, { window: asWindow(w), page });
  });
}

function summaryOf(chosen: BloodPressureObservation[], all: BloodPressureObservation[], w: { start: string; end: string }, dayWin: ReturnType<typeof makeWindow>, ctx: CapabilityContext, filtered: boolean) {
  const pair = (s: number, d: number) => formatBloodPressure(s, d, ctx.system);
  const stats = bloodPressureStats(chosen)!;
  const base = bloodPressureBaseline(chosen)!;
  const above = chosen.filter(isAboveBloodPressureReference).length;
  const data: Record<string, unknown> = {
    count: stats.count,
    referenceThreshold: pair(BP_REFERENCE_THRESHOLD.systolic, BP_REFERENCE_THRESHOLD.diastolic),
    display: {
      mean: pair(stats.systolic.mean, stats.diastolic.mean),
      median: pair(stats.systolic.median, stats.diastolic.median),
      lowest: pair(stats.systolic.min, stats.diastolic.min),
      highest: pair(stats.systolic.max, stats.diastolic.max),
    },
    rangeNote: 'lowest and highest are taken for systolic and diastolic separately, so each need not be one reading.',
    aboveReference: { count: above, share: `${Math.round((above / stats.count) * 100)}%` },
    baseline: {
      mean: pair(base.systolic.mean, base.diastolic.mean),
      low: pair(base.systolic.low, base.diastolic.low),
      high: pair(base.systolic.high, base.diastolic.high),
      basis: 'mean, and one standard deviation either side, of each number',
    },
    note: NOTE,
  };
  // Against the equal window before, when both hold readings (not for a filtered set, which would compare unlike things).
  const before = previousWindow(dayWin, diffDays(w.start, w.end) + 1);
  const change = filtered ? null : bloodPressureChange(chosen, bloodPressureInWindow(all, before));
  if (change) {
    data.change = { against: `${before.startKey} to ${before.endKey}`, delta: formatBloodPressureChange(change.systolic, change.diastolic, ctx.system) };
  }
  return data;
}
