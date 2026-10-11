// ── get_metric_series (SERVER ONLY) ─────────────────────
//
// One to three registered single-number metrics over any window, by day, week or
// month, against the equal window before it, a window of the caller's choosing, or
// nothing. The window arithmetic is `compareWindows`, the one the pages use: an
// accumulating metric (steps, energy) drops the day still in progress and any day
// flagged partial, from both sides, and the result says so.

import { isPairedMetric, metricHasData, seriesFor, unavailableReasonFor } from '../../../adapters/dataset';
import { compareWindows } from '../../../analytics/comparisons';
import { max as maxOf, median, min as minOf, mean } from '../../../analytics/stats';
import { containsDay, makeWindow } from '../../../analytics/windows';
import { formatDeltaWithUnit, formatMetricWithUnit, formatPercent, metricUnit } from '../../../metrics/format';
import { getMetric } from '../../../metrics/registry';
import { summaryFor } from '../../retrieval';
import type { RetrievedSummary } from '../../types';
import { resolveMetric } from '../../tools/metric-resolve';
import { manifestEntry } from '../manifest';
import { ok, pageRows, type EnvelopePage } from '../envelope';
import type { CapabilityContext, Coverage } from '../types';
import { resolveWindow, type ResolvedWindow } from '../window';
import { asWindow, emptyWindow, guarded, problemsOf, spanOf, windowLength, windowOf, type Args, type Read } from './common';
import { AGGREGATE_NOTE, GRANULARITIES, pickGranularity, pointsFor, type Granularity } from './series-points';

const entry = () => manifestEntry('metrics.series');
export const MAX_SERIES_METRICS = 3;
const MAX_CHARS = 12_000;
const RESERVED_CHARS = 3_000;

type Compare = { kind: 'previous' } | { kind: 'none' } | { kind: 'window'; start: string; end: string };

function compareOf(input: unknown, ctx: CapabilityContext): Compare | string[] {
  if (input === undefined || input === 'previous') return { kind: 'previous' };
  if (input === 'none') return { kind: 'none' };
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const w = resolveWindow(input, { refKey: ctx.refKey, defaultLastDays: 1 });
    if (!w.ok) return w.problems.map(p => `compareTo: ${p}`);
    if (w.window.asked.startsWith('lastDays') || w.window.asked.startsWith('day ') || w.window.asked.startsWith('month ')) return ['compareTo: give start and end, or "previous", or "none".'];
    return { kind: 'window', start: w.window.start, end: w.window.end };
  }
  return ['compareTo must be "previous", "none", or { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }.'];
}

/** The summary a card or number audit can cite, kept the way the older tools keep one. */
function remember(ctx: CapabilityContext, s: RetrievedSummary): void {
  const f = ctx.access.fetched;
  const i = f.summaries.findIndex(x => x.metricId === s.metricId && x.window.startKey === s.window.startKey && x.window.endKey === s.window.endKey);
  if (i >= 0) f.summaries[i] = s;
  else f.summaries.push(s);
  f.recordsRead += s.points.length;
}

function oneMetric(id: string, w: ResolvedWindow, g: Granularity, cmp: Compare, offset: number, budget: number, ctx: CapabilityContext) {
  const meta = getMetric(id)!;
  const accumulating = meta.aggregationStrategy === 'sum';
  const days = windowLength(w);
  const baseline = cmp.kind === 'window' ? { baseline: () => makeWindow(cmp.start, cmp.end, 'Comparison window') } : {};
  const c = compareWindows(id, ctx.refKey, days, { meta, endKey: w.end, ...baseline });
  const inWin = makeWindow(w.start, w.end, '');
  // A day still accumulating is not a day: it would drag a daily total down.
  const kept = seriesFor(id).filter(p => containsDay(inWin, p.key) && (!accumulating || (p.partial !== true && p.key !== ctx.refKey)));
  if (kept.length === 0) return null;
  const values = kept.map(p => p.value);
  const show = (v: number) => formatMetricWithUnit(id, v, ctx.system);
  const latest = kept[kept.length - 1];

  const notes = [c.exclusionNote, g !== 'day' && g !== 'summary' ? AGGREGATE_NOTE : null].filter((n): n is string => Boolean(n));
  const out: Record<string, unknown> = {
    metricId: id,
    metricName: meta.displayName,
    unit: metricUnit(id, ctx.system) || 'count (no unit)',
    aggregation: accumulating ? 'daily total, complete days only' : meta.aggregationStrategy === 'latest' ? 'latest recorded value' : 'daily average',
    observations: kept.length,
    summary: { mean: show(mean(values)), median: show(median(values)), min: show(minOf(values)), max: show(maxOf(values)), latest: show(latest.value), latestOn: latest.key },
    granularity: g,
  };
  if (cmp.kind !== 'none') {
    out.compareWindow = { start: c.baselineWindow.startKey, end: c.baselineWindow.endKey };
    if (c.comparison.valid) {
      out.change = {
        current: show(c.comparison.current),
        baseline: show(c.comparison.baseline),
        delta: formatDeltaWithUnit(id, c.comparison.delta, ctx.system),
        percent: formatPercent(c.comparison.deltaPercent),
        basis: c.lengthLabel,
      };
    } else out.change = { note: 'No comparison: one of the two windows has too few observations.' };
  }
  if (g !== 'summary') {
    const rows = pointsFor(id, kept, g, ctx.system);
    const paged = pageRows(rows, { limit: rows.length, offset, maxChars: budget });
    out.points = paged.rows;
    if (paged.page.nextOffset !== undefined || offset > 0) out.page = paged.page satisfies EnvelopePage;
  }
  if (notes.length) out.note = notes.join(' ');

  // Cite the metric: a full summary when the window is one the dataset can summarise (it ends today).
  const ends = w.end === ctx.refKey && cmp.kind === 'previous';
  if (ends) remember(ctx, summaryFor(id, days, ctx.refKey).summary);
  else {
    ctx.access.fetched.citable.add(id);
    ctx.access.fetched.recordsRead += kept.length;
  }
  ctx.access.fetched.log.push(`${meta.displayName}, ${w.start}..${w.end}`);
  return out;
}

export async function metricSeriesCoverage(ctx: CapabilityContext, id?: string): Promise<Coverage> {
  void ctx;
  const meta = id ? getMetric(id) : undefined;
  if (!id || !meta) return { kind: 'known', first: null, last: null, count: 0, unit: 'days' };
  return spanOf(seriesFor(id).map(p => p.key), `days of ${meta.displayName.toLowerCase()}`);
}

export function readMetricSeries(args: Args, ctx: CapabilityContext): Promise<Read> {
  return guarded(entry(), ctx, async () => {
    const names = Array.isArray(args.metrics) ? (args.metrics as unknown[]).map(String) : [];
    if (names.length < 1 || names.length > MAX_SERIES_METRICS) return problemsOf(entry(), [`metrics must hold from 1 to ${MAX_SERIES_METRICS} metric ids.`]);
    if (args.granularity !== undefined && !(GRANULARITIES as readonly string[]).includes(String(args.granularity))) return problemsOf(entry(), [`granularity must be one of: ${GRANULARITIES.join(', ')}.`]);
    const win = windowOf(args, ctx, 30);
    if (!win.ok) return problemsOf(entry(), win.problems);
    const cmp = compareOf(args.compareTo, ctx);
    if (Array.isArray(cmp)) return problemsOf(entry(), cmp);
    const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;

    const ids: string[] = [];
    const problems: string[] = [];
    let didYouMean: string[] = [];
    for (const name of names) {
      const r = resolveMetric(name);
      if ('error' in r) {
        problems.push(r.error);
        didYouMean = [...didYouMean, ...r.didYouMean];
      } else if (isPairedMetric(r.id)) problems.push(`${getMetric(r.id)?.displayName ?? r.id} is a pair of numbers per reading, so it has no single series here. Use get_blood_pressure.`);
      else if (!ids.includes(r.id)) ids.push(r.id);
    }
    if (problems.length) return problemsOf(entry(), problems, didYouMean.length ? { didYouMean: [...new Set(didYouMean)] } : undefined);

    const w = win.window;
    const g = pickGranularity(args.granularity as string | undefined, windowLength(w));
    const budget = Math.floor((MAX_CHARS - RESERVED_CHARS) / ids.length);
    const results: Record<string, unknown>[] = [];
    const noData: { metric: string; reason: string }[] = [];
    for (const id of ids) {
      if (!metricHasData(id)) {
        noData.push({ metric: id, reason: unavailableReasonFor(id) });
        continue;
      }
      const r = oneMetric(id, w, g, cmp, offset, budget, ctx);
      if (r) results.push(r);
      else noData.push({ metric: id, reason: `No ${getMetric(id)?.displayName ?? id} value is recorded between ${w.start} and ${w.end}.` });
    }
    if (results.length === 0) {
      const first = ids.find(metricHasData);
      return emptyWindow(entry(), w, await metricSeriesCoverage(ctx, first), noData.length ? { noData } : undefined);
    }
    return ok(entry(), { unitSystem: ctx.system, metrics: results, ...(noData.length ? { noData } : {}) }, { window: asWindow(w) });
  });
}
