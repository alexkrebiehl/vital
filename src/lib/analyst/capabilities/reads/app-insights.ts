// ── insights.current and insights.reports (SERVER ONLY) ──────────────────────
//
// The Insights page as text. Both are computed from the installed dataset by the
// functions the page calls, so they cannot disagree with it. Chart points and links
// stay behind; each figure that is quoted is already a sentence.

import { generateInsights, type Insight } from '../../../analytics/insights';
import { buildMonthlyReports, buildWeeklyReports, type PeriodReport } from '../../../analytics/reports';
import { formatPercent } from '../../../metrics/format';
import { manifestEntry } from '../manifest';
import { ok, pageRows } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, pagingOf, problemsOf, type Args, type Read } from './common';
import { nothing } from './app-common';

const MAX_CHARS = 9_500;
export const MAX_REPORTS = 12;
const DEFAULT_REPORTS = 4;

function insightRow(i: Insight) {
  return {
    kind: i.kind,
    title: i.title,
    summary: i.summary,
    detail: i.detail,
    window: i.windowLabel,
    coverage: i.coverage,
    computed: i.computed,
    evidence: i.evidence.map(e => `${e.metricName} \u00b7 ${e.windowLabel} \u00b7 ${e.aggregation} \u00b7 ${e.coverage}`),
    caveat: i.caveat,
  };
}

export function readInsights(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('insights.current');
  return guarded(entry, ctx, async () => {
    const insights = generateInsights(ctx.refKey, ctx.system);
    if (insights.length === 0) {
      return nothing(entry, 'No insight is available today: none of the changes or associations meets the evidence thresholds (at least 5 observations on both sides of a comparison).');
    }
    const { rows, page } = pageRows(insights, { limit: 20, offset: 0, maxChars: MAX_CHARS, render: insightRow });
    return ok(entry, { insights: rows }, { page });
  });
}

function reportRow(r: PeriodReport) {
  return {
    title: r.title,
    period: r.periodLabel,
    window: { start: r.window.startKey, end: r.window.endKey },
    partial: r.partial,
    coverageNote: r.coverageNote,
    paragraphs: r.paragraphs,
    lines: r.lines.map(l => ({
      metric: l.metricName,
      value: l.value,
      aggregation: l.aggregation,
      observations: l.observations,
      coverage: l.coverage,
      change: l.deltaPercent === null ? l.deltaValue : `${l.deltaValue} (${formatPercent(l.deltaPercent)})`,
    })),
    highlights: r.highlights,
  };
}

export function readReports(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('insights.reports');
  return guarded(entry, ctx, async () => {
    const problems: string[] = [];
    if (args.kind !== 'weekly' && args.kind !== 'monthly') problems.push('kind must be weekly or monthly.');
    const count = args.count ?? DEFAULT_REPORTS;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_REPORTS) problems.push(`count must be a whole number from 1 to ${MAX_REPORTS}.`);
    const paged = pagingOf(args, MAX_REPORTS, MAX_REPORTS);
    if (!paged.ok) problems.push(...paged.problems);
    if (problems.length || !paged.ok) return problemsOf(entry, problems);
    const built = args.kind === 'weekly' ? buildWeeklyReports(ctx.refKey, count as number, ctx.system) : buildMonthlyReports(ctx.refKey, count as number, ctx.system);
    if (built.length === 0) return nothing(entry, `No complete ${args.kind} period is covered by the data yet.`);
    const { rows, page } = pageRows(built, { limit: paged.paging.limit, offset: paged.paging.offset, maxChars: MAX_CHARS, render: reportRow });
    return ok(entry, { kind: args.kind, reports: rows }, { page });
  });
}
