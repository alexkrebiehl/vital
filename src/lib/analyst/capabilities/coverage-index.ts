// ── The coverage index (design §5.2, SERVER ONLY for the collector) ──────────
//
// What the model is given in the user message, in BOTH context modes: today's date,
// one line per capability saying what the app holds and for which dates, the metrics
// with data, and the lab panel dates and categories. It carries no values. A name
// that is in it exists; one that is not is not a claim of absence: absence is a tool
// result (`no_data_in_window`), never an inference from this list.
//
// Bounded at 6,000 characters. When over, the metric lines collapse to one per
// category with a stated count; when still over, so do the lab lines.

import { buildLabIndex, buildMetricIndex, type LabIndex, type MetricIndexEntry } from '../dataIndex';
import type { LabSourceInput } from '../labSnapshot';
import { scrubForModel } from '../scrub';
import type { AuditEntry } from './absence';
import type { Capability, CapabilityContext, Coverage, SendingCategory } from './types';

export const COVERAGE_INDEX_MAX_CHARS = 6_000;
const WITHHELD = 'withheld by the AI privacy setting';
/** Panel dates shown once the lab lines are collapsed. */
const PANEL_DATES_COLLAPSED = 12;

export interface CoverageRow {
  id: string;
  title: string;
  coverage: Coverage | { kind: 'withheld' };
}

export interface CoverageIndexInput {
  refKey: string;
  rows: readonly CoverageRow[];
  metrics: readonly MetricIndexEntry[];
  labs: LabIndex;
  /** Which of the two blocks the privacy setting withholds. */
  withheld?: { metrics?: boolean; labs?: boolean };
}

/** One coverage as the model reads it. */
export function coverageText(c: CoverageRow['coverage']): string {
  if (c.kind === 'withheld') return WITHHELD;
  if (c.kind === 'unknown') return 'unknown — fetch to see';
  if (c.kind === 'unavailable') return `unavailable — ${scrubForModel(c.reason).replace(/[.\s]+$/, '')}`;
  if (c.count === 0) return 'the app holds none';
  const span = c.first && c.last ? `${c.first}..${c.last} · ` : '';
  return `${span}${c.count} ${c.unit}`;
}

function metricLines(metrics: readonly MetricIndexEntry[], withheld: boolean, collapse: boolean): string[] {
  if (withheld) return [`METRICS — ${WITHHELD}.`];
  if (!collapse) {
    return [
      `METRICS (${metrics.length} with data): id | name | first..last day | days recorded | how often. Fetch with get_metric_series.`,
      ...metrics.map(m => `${m.id} | ${m.name} | ${m.from}..${m.to} | ${m.days} | ${m.frequency}`),
    ];
  }
  const byCategory = new Map<string, MetricIndexEntry[]>();
  for (const m of metrics) byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m]);
  return [
    `METRICS (${metrics.length} with data), collapsed to one line per category; ids to fetch with get_metric_series. list_capabilities and any tool result state the dates.`,
    ...[...byCategory.entries()].map(([category, list]) => `${category} — ${list.length} metric${list.length === 1 ? '' : 's'}: ${list.map(m => m.id).join(', ')}`),
  ];
}

function labLines(labs: LabIndex, withheld: boolean, collapse: boolean): string[] {
  if (withheld) return [`LAB RESULTS — ${WITHHELD}.`];
  if (!labs.available) return [`LAB RESULTS — not available: ${labs.reason ?? 'unknown reason'}`];
  const head = `LAB RESULTS — ${labs.documents} documents, ${labs.observations} observations. Fetch with get_lab_results / compare_lab_panels.`;
  if (!collapse) {
    return [
      head,
      `Panel dates (date: series measured): ${labs.panelDates.map(d => `${d.on}: ${d.series}`).join(', ') || 'none'}`,
      ...labs.categories.map(c => `${c.category}: ${c.series.map(s => `${s.name}${s.observations > 1 ? ` (${s.observations}×)` : ''}`).join(', ')}`),
    ];
  }
  const shown = labs.panelDates.slice(-PANEL_DATES_COLLAPSED);
  const earlier = labs.panelDates.length - shown.length;
  return [
    head,
    `Panel dates (date: series measured), latest first${earlier > 0 ? `; ${earlier} earlier panel dates not listed` : ''}: ${shown.reverse().map(d => `${d.on}: ${d.series}`).join(', ') || 'none'}`,
    'Categories (ask get_lab_results by category to see the series):',
    ...labs.categories.map(c => `${c.category}: ${c.series.length} series`),
  ];
}

function assemble(input: CoverageIndexInput, collapseMetrics: boolean, collapseLabs: boolean): string {
  const lines: string[] = [
    `COVERAGE — what the app holds right now. Today is ${input.refKey}. Nothing here is a value. Whatever is not listed or not in the selection may still exist: absence is a tool result (no_data_in_window), never an inference from this list.`,
    '',
    'CAPABILITIES — id · first..last · count unit:',
    ...input.rows.map(r => `${r.id} · ${coverageText(r.coverage)}`),
    '',
    ...metricLines(input.metrics, Boolean(input.withheld?.metrics), collapseMetrics),
    '',
    ...labLines(input.labs, Boolean(input.withheld?.labs), collapseLabs),
  ];
  return lines.join('\n');
}

export function renderCoverageIndex(input: CoverageIndexInput): string {
  let text = assemble(input, false, false);
  if (text.length <= COVERAGE_INDEX_MAX_CHARS) return text;
  text = assemble(input, true, false);
  if (text.length <= COVERAGE_INDEX_MAX_CHARS) return text;
  return assemble(input, true, true);
}

type Reader = Pick<Capability<never, never>, 'id' | 'title' | 'category' | 'coverage'>;

/**
 * Every capability's coverage, as the model is told it. A withheld category is not read;
 * a coverage that cannot be read is `unavailable` with fixed words, never the error.
 */
export async function collectCoverageRows(caps: readonly Reader[], ctx: CapabilityContext): Promise<CoverageRow[]> {
  return Promise.all(
    caps.map(async (c): Promise<CoverageRow> => {
      if (!ctx.policy.allows(c.category)) return { id: c.id, title: c.title, coverage: { kind: 'withheld' } };
      try {
        return { id: c.id, title: c.title, coverage: await c.coverage(ctx) };
      } catch {
        return { id: c.id, title: c.title, coverage: { kind: 'unavailable', reason: 'The coverage could not be read.' } };
      }
    })
  );
}

const allows = (ctx: CapabilityContext, category: SendingCategory): boolean => ctx.policy.allows(category);

/** The coverage index of one question, and the rows it was made from (the absence audit reads the same rows). */
export interface BuiltCoverage {
  text: string;
  rows: CoverageRow[];
}

/** The index for one question: the live coverages, the metrics the dataset holds, and the lab source (read once). */
export async function buildCoverageIndex(caps: readonly Reader[], ctx: CapabilityContext): Promise<BuiltCoverage> {
  const rows = await collectCoverageRows(caps, ctx);
  const withheld = { metrics: !allows(ctx, 'metric-summaries'), labs: !allows(ctx, 'lab-results') };
  let lab: LabSourceInput;
  try {
    lab = withheld.labs ? { available: true, reason: null, documents: 0, totalObservations: 0, collisions: 0, series: [] } : await ctx.access.labSource();
  } catch {
    lab = { available: false, reason: 'The lab results could not be read.', documents: 0, totalObservations: 0, collisions: 0, series: [] };
  }
  const text = renderCoverageIndex({
    refKey: ctx.refKey,
    rows,
    metrics: withheld.metrics ? [] : buildMetricIndex(),
    labs: buildLabIndex(lab),
    withheld,
  });
  return { text, rows };
}

/** The rows joined to what the absence audit needs of each capability. */
export function auditEntries(caps: readonly (Reader & Pick<Capability<never, never>, 'tool' | 'absenceTerms'>)[], rows: readonly CoverageRow[]): AuditEntry[] {
  return caps.flatMap(c => {
    const row = rows.find(r => r.id === c.id);
    return row ? [{ id: c.id, title: c.title, tool: c.tool, absenceTerms: c.absenceTerms, coverage: row.coverage }] : [];
  });
}
