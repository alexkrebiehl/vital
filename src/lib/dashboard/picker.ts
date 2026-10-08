// ── The metrics a card's picker offers, grouped by category (pure) ───────────
//
// docs/design/dashboard.md §8.6. Search covers names and aliases; the offered
// set is the one Trends offers (`listedMetrics`). A metric with no data stays
// listed and is flagged. Nothing here names a data source.

import { getAllMetrics, getCategories, searchMetrics } from '@/lib/metrics';
import { listedMetrics } from '@/lib/metrics/listed';
import type { MetricCategory } from '@/lib/metrics/types';

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  cardiovascular: 'Cardiovascular',
  activity: 'Activity',
  sleep: 'Sleep',
  body: 'Body',
  nutrition: 'Nutrition',
  respiratory: 'Respiratory',
  recovery: 'Recovery',
  vitals: 'Vitals',
};

export interface PickerMetric {
  id: string;
  displayName: string;
  hasData: boolean;
}

export interface PickerGroup {
  category: MetricCategory;
  label: string;
  metrics: PickerMetric[];
}

export function pickerGroups(
  query: string,
  activeSources: readonly string[] | undefined,
  hasData: (metricId: string) => boolean
): PickerGroup[] {
  const q = query.trim();
  const found = listedMetrics(q ? searchMetrics(q) : getAllMetrics(), activeSources, hasData);
  return getCategories()
    .map(category => ({
      category,
      label: CATEGORY_LABELS[category],
      metrics: found
        .filter(m => m.category === category)
        .map(m => ({ id: m.id, displayName: m.displayName, hasData: hasData(m.id) })),
    }))
    .filter(g => g.metrics.length > 0);
}
