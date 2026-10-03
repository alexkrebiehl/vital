// ── The data index (pure) ───────────────────────────────
//
// What the model is given INSTEAD of the data in on-demand mode: a map of what
// exists and for what dates, small enough to read every time (a few thousand
// characters whatever the amount of data) and complete enough that "this is not
// recorded" can be said truthfully — a name that is absent from the index is absent
// from the data. It carries no values: to see a value the model calls a tool.

import { availableMetricIds, coverageFor, metricHasData } from '../adapters/dataset';
import { getMetric } from '../metrics/registry';
import type { LabSourceInput } from './labSnapshot';

export interface MetricIndexEntry {
  id: string;
  name: string;
  category: string;
  from: string;
  to: string;
  /** Days with a reading, out of the days in range. */
  days: string;
  frequency: string;
}

export interface LabIndex {
  available: boolean;
  reason: string | null;
  documents: number;
  observations: number;
  /** Every date a panel was measured, with how many series it holds. */
  panelDates: { on: string; series: number }[];
  /** Series by category: the display names the tools accept. */
  categories: { category: string; series: { key: string; name: string; observations: number; latest: string }[] }[];
}

export interface DataIndex {
  referenceDay: string;
  metrics: MetricIndexEntry[];
  labs: LabIndex;
  medications: string;
  workouts: string;
}

export function buildMetricIndex(): MetricIndexEntry[] {
  const out: MetricIndexEntry[] = [];
  for (const id of availableMetricIds()) {
    if (!metricHasData(id)) continue;
    const meta = getMetric(id);
    const cov = coverageFor(id);
    out.push({
      id,
      name: meta?.displayName ?? id,
      category: meta?.category ?? 'other',
      from: cov?.firstObservation?.slice(0, 10) ?? '',
      to: cov?.lastObservation?.slice(0, 10) ?? '',
      days: cov ? `${cov.observedDays}/${cov.expectedDays}` : '',
      frequency: cov?.samplingFrequency ?? '',
    });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function buildLabIndex(source: LabSourceInput): LabIndex {
  if (!source.available) {
    return { available: false, reason: source.reason, documents: 0, observations: 0, panelDates: [], categories: [] };
  }
  const dates = new Map<string, number>();
  const byCategory = new Map<string, LabIndex['categories'][number]['series']>();
  for (const s of source.series) {
    for (const p of s.points) dates.set(p.on, (dates.get(p.on) ?? 0) + 1);
    const list = byCategory.get(s.category) ?? [];
    list.push({ key: s.seriesKey, name: s.displayName, observations: s.points.length, latest: s.points.length ? s.points[s.points.length - 1]!.on : '' });
    byCategory.set(s.category, list);
  }
  return {
    available: true,
    reason: null,
    documents: source.documents,
    observations: source.totalObservations,
    panelDates: [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([on, series]) => ({ on, series })),
    categories: [...byCategory.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, series]) => ({ category, series: series.sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}

export function buildDataIndex(referenceDay: string, lab: LabSourceInput): DataIndex {
  return {
    referenceDay,
    metrics: buildMetricIndex(),
    labs: buildLabIndex(lab),
    medications: 'Logged doses are available from get_medications (last N days).',
    workouts: 'The workout log is available from get_workouts (last N days).',
  };
}

/** The index as text for the user message: compact lines, no values. */
export function renderDataIndex(index: DataIndex): string {
  const lines: string[] = [];
  lines.push(`Today (latest day in the data): ${index.referenceDay}.`);
  lines.push('');
  lines.push('METRICS — id | name | first..last day | days recorded | how often. Fetch with get_metrics / compare_periods / get_metric_relationship.');
  for (const m of index.metrics) lines.push(`${m.id} | ${m.name} | ${m.from}..${m.to} | ${m.days} | ${m.frequency}`);
  lines.push('');
  const L = index.labs;
  if (!L.available) {
    lines.push(`LAB RESULTS — not available: ${L.reason ?? 'unknown reason'}`);
  } else {
    lines.push(`LAB RESULTS — ${L.documents} documents, ${L.observations} observations. Fetch with get_lab_results / compare_lab_panels.`);
    lines.push(`Panel dates (date: series measured): ${L.panelDates.map(d => `${d.on}: ${d.series}`).join(', ') || 'none'}`);
    for (const c of L.categories) {
      lines.push(`${c.category}: ${c.series.map(s => `${s.name}${s.observations > 1 ? ` (${s.observations}×)` : ''}`).join(', ')}`);
    }
  }
  lines.push('');
  lines.push(index.medications);
  lines.push(index.workouts);
  return lines.join('\n');
}
