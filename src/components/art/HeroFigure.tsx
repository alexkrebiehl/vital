'use client';

import Link from 'next/link';
import { seriesFor, seriesInWindow, REFERENCE_KEY } from '@/lib/adapters/dataset';
import { trailingWindow, formatDayKeyLong } from '@/lib/analytics';
import { formatMetricValue, metricUnit } from '@/lib/metrics/format';
import { getMetric } from '@/lib/metrics';
import { useUnits } from '@/components/ui/UnitsProvider';
import { Spark } from './Spark';
import { CATEGORY_VAR, type ArtCategory } from './categories';

/**
 * The headline figure in a page banner: the latest reading of one metric, its
 * date, and the shape of the last `days` days. Everything comes from the
 * dataset; a metric with no observation renders nothing rather than a dash.
 */
export function HeroFigure({
  metricId, category = 'neutral', days = 30, label,
}: { metricId: string; category?: ArtCategory; days?: number; label?: string }) {
  const { units } = useUnits();
  const meta = getMetric(metricId);
  const all = seriesFor(metricId);
  // A summed metric (steps, energy) accumulates through the day, so today's point
  // is partial. Lead with the last complete day and say so, rather than show a
  // half-finished total as if it were the day's result.
  const partialToday =
    meta?.aggregationStrategy === 'sum' && all.length > 0 && all[all.length - 1].key === REFERENCE_KEY;
  const latest = partialToday ? all[all.length - 2] : all.length ? all[all.length - 1] : undefined;
  if (!meta || !latest) return null;
  const pts = seriesInWindow(metricId, trailingWindow(REFERENCE_KEY, days));
  const formatted = formatMetricValue(metricId, latest.value, units);
  // Duration formats (7h 14m) already carry their unit; a bare number takes the metric's.
  const unit = /[a-z]/i.test(formatted) ? '' : metricUnit(metricId, units);
  const color = CATEGORY_VAR[category];
  return (
    <Link
      href={`/metric/${metricId}`}
      className="block w-full max-w-[260px] rounded-2xl border border-border bg-surface/80 p-4 backdrop-blur-sm shadow-card transition-colors hover:border-border-strong"
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">{label ?? meta.displayName}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[34px] font-semibold leading-none tnum tracking-[-0.03em] text-text-primary">
          {formatted}
        </span>
        {unit && <span className="text-sm text-text-secondary">{unit}</span>}
      </div>
      <div className="mt-1 text-[11px] text-text-secondary">{partialToday ? 'Last complete day' : 'Latest'} · {formatDayKeyLong(latest.key)}</div>
      <div className="mt-3"><Spark values={pts.map(p => p.value)} color={color} /></div>
      <div className="mt-1 text-[11px] text-text-secondary">
        {pts.length >= 2 ? `Last ${days} days · ${pts.length} readings` : `${pts.length} reading in the last ${days} days`}
      </div>
    </Link>
  );
}
