// ── The data index parts (pure) ─────────────────────────
//
// The metric and lab lines of the coverage index (capabilities/coverage-index.ts,
// which renders them): what exists and for which dates, small enough to read every
// time. No values: to see a value the model calls a tool.

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
