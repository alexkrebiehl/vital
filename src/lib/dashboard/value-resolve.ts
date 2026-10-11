// ── Dashboard: resolve a value card from the active dataset (pure) ───────────
//
// docs/design/dashboard.md §6. A card stores a metric id and a date; this turns
// them into strings ready to print. Every number goes through the registry
// formatter, so the renderer holds none. A missing day is never a zero: it is
// one of the explicit states, checked in the order of §6.4.

import {
  bloodPressureSeries,
  excludePartialForSum,
  isPairedMetric,
  metricHasData,
  seriesInWindow,
  unavailableReasonFor,
  type DayPoint,
} from '@/lib/adapters/dataset';
import { bloodPressureInWindow, bloodPressureStats } from '@/lib/analytics/bloodPressure';
import { aggregate } from '@/lib/analytics/stats';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { getMetric } from '@/lib/metrics';
import { formatBloodPressure, formatDurationAggregate, formatMetricWithUnit } from '@/lib/metrics/format';
import type { BloodPressureObservation } from '@/lib/metrics/types';
import type { UnitSystem } from '@/lib/prefs';
import { resolveDateSpec } from './date-spec';
import type { ValueCardSpec } from './types';

export interface ValueResolveContext {
  /** Always `REFERENCE_KEY`: the app has one notion of "today". */
  referenceKey: string;
  system: UnitSystem;
}

export type ValueCardData =
  | {
      state: 'value';
      dateLabel: string;
      headline: string;
      qualifier: string;
      detail?: string;
      note?: string;
      spark?: { kind: 'line'; values: number[] } | { kind: 'pair'; readings: BloodPressureObservation[] };
    }
  | { state: 'no-reading'; dateLabel: string; reason: string }
  | { state: 'unavailable'; dateLabel: string; reason: string }
  | { state: 'unknown-metric'; reason: string };

export const UNKNOWN_METRIC_REASON = 'This metric is not part of this version of Vital.';
const TODAY_IN_PROGRESS = "The only reading in this range is today's, which is still in progress.";
const ONLY_INCOMPLETE_DAYS = 'The only readings in this range are from incomplete days.';
const TODAY_EXCLUDED = 'Today excluded (still in progress).';
const SLEEP_ID = 'sleep_analysis';

interface Daily {
  key: string;
  value: number;
  partial?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One value per day: two points of one day are aggregated by the metric's own strategy first. */
function groupByDay(points: DayPoint[], strategy: string): Daily[] {
  const byDay = new Map<string, DayPoint[]>();
  for (const p of points) byDay.set(p.key, [...(byDay.get(p.key) ?? []), p]);
  return [...byDay.entries()].map(([key, group]) => ({
    key,
    value: group.length === 1 ? group[0].value : aggregate(group.map(p => p.value), strategy),
    ...(group.some(p => p.partial) ? { partial: true } : {}),
  }));
}

/** Which daily value stands for a range, and what to call it. */
export function pickFromDaily(
  strategy: string,
  daily: { key: string; value: number }[]
): { value: number; key?: string; label: string } {
  const values = daily.map(d => d.value);
  const at = (value: number) => daily.find(d => d.value === value)?.key;
  switch (strategy) {
    case 'sum':
      return { value: aggregate(values, 'sum'), label: 'Total' };
    case 'latest':
      return { value: values[values.length - 1], key: daily[daily.length - 1].key, label: 'Latest' };
    case 'min': {
      const value = aggregate(values, 'min');
      return { value, key: at(value), label: 'Lowest' };
    }
    case 'max': {
      const value = aggregate(values, 'max');
      return { value, key: at(value), label: 'Highest' };
    }
    default:
      return { value: aggregate(values, 'avg'), label: 'Average' };
  }
}

function noReading(
  name: string,
  win: { startKey: string; endKey: string },
  dateLabel: string,
  todaySum: boolean
): ValueCardData {
  if (win.startKey === win.endKey) {
    return {
      state: 'no-reading',
      dateLabel,
      reason: todaySum ? 'Nothing recorded yet today.' : `No ${name} reading on ${formatDayKeyLong(win.startKey)}.`,
    };
  }
  return {
    state: 'no-reading',
    dateLabel,
    reason: `No ${name} readings between ${formatDayKeyLong(win.startKey)} and ${formatDayKeyLong(win.endKey)}.`,
  };
}

export function resolveValueCard(spec: ValueCardSpec, ctx: ValueResolveContext): ValueCardData {
  const meta = getMetric(spec.metricId);
  if (!meta) return { state: 'unknown-metric', reason: UNKNOWN_METRIC_REASON };

  const resolved = resolveDateSpec(spec.date, ctx.referenceKey);
  const { window: win, label: dateLabel } = resolved;
  const single = win.startKey === win.endKey;

  if (!metricHasData(meta.id)) {
    return { state: 'unavailable', dateLabel, reason: unavailableReasonFor(meta.id) };
  }
  if (resolved.afterReference) {
    return {
      state: 'no-reading',
      dateLabel,
      reason: `These dates are after the latest day in the data (${formatDayKeyLong(ctx.referenceKey)}).`,
    };
  }

  if (isPairedMetric(meta.id)) {
    const readings = bloodPressureInWindow(bloodPressureSeries(), win);
    const last = readings[readings.length - 1];
    const stats = bloodPressureStats(readings);
    if (!last || !stats) return noReading(meta.displayName, win, dateLabel, false);
    const headline = formatBloodPressure(last.systolic, last.diastolic, ctx.system);
    if (single) {
      return {
        state: 'value',
        dateLabel,
        headline,
        qualifier: stats.count > 1 ? `Latest of ${stats.count} readings` : '',
      };
    }
    const average = formatBloodPressure(stats.systolic.mean, stats.diastolic.mean, ctx.system);
    return {
      state: 'value',
      dateLabel,
      headline,
      qualifier: `Latest · ${formatDayKeyLong(last.date)}`,
      detail: `Average ${average} · ${plural(stats.count, 'reading')}`,
      ...(stats.count >= 2 ? { spark: { kind: 'pair' as const, readings } } : {}),
    };
  }

  const strategy = meta.aggregationStrategy;
  const sum = strategy === 'sum';
  const daily = groupByDay(seriesInWindow(meta.id, win), strategy);
  const todaySum = sum && single && win.startKey === ctx.referenceKey;
  if (daily.length === 0) return noReading(meta.displayName, win, dateLabel, todaySum);

  if (single) {
    const day = daily[0];
    return {
      state: 'value',
      dateLabel,
      headline: formatMetricWithUnit(meta.id, day.value, ctx.system),
      qualifier: todaySum ? 'So far today' : sum ? 'Day total' : '',
      ...(sum && day.partial && !todaySum ? { note: 'This day’s record is incomplete.' } : {}),
    };
  }

  let included = daily;
  let note: string | undefined;
  if (sum) {
    const points: DayPoint[] = daily.map(d => ({ ...d, source: '' }));
    const { values, excludedDays } = excludePartialForSum(points, meta);
    if (values.length === 0) {
      const onlyToday = excludedDays.length === 1 && excludedDays[0] === ctx.referenceKey;
      return { state: 'no-reading', dateLabel, reason: onlyToday ? TODAY_IN_PROGRESS : ONLY_INCOMPLETE_DAYS };
    }
    included = daily.filter(d => !excludedDays.includes(d.key));
    const incomplete = excludedDays.filter(k => k !== ctx.referenceKey).length;
    note =
      [
        excludedDays.includes(ctx.referenceKey) ? TODAY_EXCLUDED : '',
        incomplete > 0 ? `${plural(incomplete, 'incomplete day')} excluded.` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined;
  }

  const picked = pickFromDaily(strategy, included);
  const values = included.map(d => d.value);
  const days = plural(included.length, 'day');
  let qualifier: string;
  if (sum) qualifier = `Total · ${days} with readings`;
  else if (picked.key) qualifier = `${picked.label} · ${formatDayKeyLong(picked.key)}`;
  else if (meta.id === SLEEP_ID) qualifier = `${picked.label} · ${plural(included.length, 'night')}`;
  else qualifier = `${picked.label} · ${days} with readings`;

  return {
    state: 'value',
    dateLabel,
    headline: formatDurationAggregate(meta.id, picked.value, ctx.system),
    qualifier,
    ...(sum
      ? { detail: `Avg ${formatDurationAggregate(meta.id, aggregate(values, 'avg'), ctx.system)} per day with a reading` }
      : {}),
    ...(note ? { note } : {}),
    // Sleep is drawn with its stages; a single line would not be.
    ...(meta.id !== SLEEP_ID && values.length >= 2 ? { spark: { kind: 'line' as const, values } } : {}),
  };
}
