// ── Which metrics a page lists ───────────────────────────
//
// The registry holds every metric Vital knows. A page that lists them should
// not offer "No data" rows for measures none of the connected sources can ever
// provide: with only a ring connected, Apple-only measures (walking heart rate,
// exercise minutes, BMI) are not gaps, they are simply not part of this data.
// A metric is listed when it has data now, or when a connected source can
// provide it. Demo data, and a dataset that does not say which sources it read,
// list everything.

import { mappingFor } from '@/lib/adapters/normalize';
import { OURA_METRIC_IDS } from '@/lib/adapters/oura/normalize';

/** Metrics the Health Auto Export adapter builds outside the plain mapping table. */
const HAE_SPECIAL = new Set(['sleep_analysis', 'sleep_in_bed', 'blood_pressure']);

export function sourceCanProvide(sourceId: string, metricId: string): boolean {
  if (sourceId === 'hae') return HAE_SPECIAL.has(metricId) || mappingFor(metricId) !== undefined;
  if (sourceId === 'oura') return OURA_METRIC_IDS.has(metricId);
  return false;
}

export function isListed(
  metricId: string,
  activeSources: readonly string[] | undefined,
  hasData: (id: string) => boolean
): boolean {
  if (!activeSources || activeSources.length === 0) return true;
  if (hasData(metricId)) return true;
  return activeSources.some(s => sourceCanProvide(s, metricId));
}

export function listedMetrics<T extends { id: string }>(
  metrics: readonly T[],
  activeSources: readonly string[] | undefined,
  hasData: (id: string) => boolean
): T[] {
  return metrics.filter(m => isListed(m.id, activeSources, hasData));
}
