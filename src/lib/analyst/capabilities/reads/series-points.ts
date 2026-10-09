// ── Metric series: days, weeks or months of one metric (SERVER ONLY) ──
//
// Pure helpers for get_metric_series. A series longer than 92 days is sent by week,
// longer than 104 weeks by month, so a year of a metric is one small call. A week or
// month point is the mean of the daily values inside it, and says so.

import { addDays, dayKeyToDate } from '../../../analytics/windows';
import { mean } from '../../../analytics/stats';
import { formatMetricWithUnit } from '../../../metrics/format';
import type { UnitSystem } from '../../../prefs';

export type Granularity = 'summary' | 'day' | 'week' | 'month';
export const GRANULARITIES = ['auto', 'summary', 'day', 'week', 'month'] as const;
export const MAX_DAY_POINTS = 92;
export const MAX_WEEK_POINTS = 104;

export interface SeriesPoint {
  key: string;
  value: number;
  display: string;
  /** Days behind an aggregated point; absent for a day. */
  observations?: number;
}

/** `auto`: days up to 92 points, then weeks up to 104, then months. */
export function pickGranularity(requested: string | undefined, days: number): Granularity {
  if (requested && requested !== 'auto') return requested as Granularity;
  if (days <= MAX_DAY_POINTS) return 'day';
  return Math.ceil(days / 7) + 1 <= MAX_WEEK_POINTS ? 'week' : 'month';
}

/** The Monday on or before a day. */
export function weekStart(key: string): string {
  return addDays(key, -((dayKeyToDate(key).getUTCDay() + 6) % 7));
}

const bucketKey = (g: 'week' | 'month', key: string): string => (g === 'week' ? weekStart(key) : key.slice(0, 7));

export function pointsFor(metricId: string, days: { key: string; value: number }[], granularity: Exclude<Granularity, 'summary'>, system: UnitSystem): SeriesPoint[] {
  const show = (v: number) => formatMetricWithUnit(metricId, v, system);
  if (granularity === 'day') return days.map(d => ({ key: d.key, value: d.value, display: show(d.value) }));
  const groups = new Map<string, number[]>();
  for (const d of days) {
    const k = bucketKey(granularity, d.key);
    groups.set(k, [...(groups.get(k) ?? []), d.value]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, values]) => {
      const m = mean(values);
      return { key, value: m, display: show(m), observations: values.length };
    });
}

export const AGGREGATE_NOTE = 'Each point is the mean of the daily values in its week or month (observations says how many days).';
