'use client';

import Link from 'next/link';
import { getMetric } from '@/lib/metrics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import { seriesFor } from '@/lib/adapters/dataset';
import { formatDayKeyLong } from '@/lib/analytics';
import { Card } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { BodyFigure, type BodyAnchor, type BodyMarker } from './BodyFigure';
import { CATEGORY_VAR, type ArtCategory } from './categories';

interface Spot { metricId: string; anchor: BodyAnchor; category: ArtCategory }

/**
 * Figure plus a numbered legend of the latest reading for each requested
 * metric. A metric with no observation gets no marker and no legend row, so the
 * map can never show a value the dataset does not hold.
 */
export function BodyMap({ spots, title, note }: { spots: Spot[]; title: string; note?: string }) {
  const { units } = useUnits();

  const rows = spots
    .map(s => {
      const pts = seriesFor(s.metricId);
      const latest = pts.length ? pts[pts.length - 1] : undefined;
      const meta = getMetric(s.metricId);
      return latest && meta ? { ...s, latest, label: meta.displayName } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return null;

  const markers: BodyMarker[] = rows.map(r => ({
    id: r.metricId,
    anchor: r.anchor,
    label: r.label,
    value: formatMetricWithUnit(r.metricId, r.latest.value, units),
    color: CATEGORY_VAR[r.category],
  }));

  return (
    <Card className="overflow-hidden p-0" as="section">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(200px,280px)_1fr]">
        <div className="relative flex items-center justify-center border-b border-border bg-surface-muted/60 px-6 py-8 md:border-b-0 md:border-r">
          <BodyFigure markers={markers} className="h-[340px] w-auto" />
        </div>
        <div className="p-6 md:p-8">
          <h2 className="text-[20px] md:text-[22px] font-semibold text-text-primary">{title}</h2>
          {note && <p className="mt-1 text-sm text-text-secondary max-w-prose">{note}</p>}
          <ol className="mt-5 list-none p-0 m-0 divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.metricId}>
                <Link
                  href={`/metric/${r.metricId}`}
                  className="group flex items-center gap-4 py-3 -mx-2 px-2 rounded-lg transition-colors hover:bg-surface-muted/70"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: CATEGORY_VAR[r.category] }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-primary">{r.label}</span>
                    <span className="block text-[12px] text-text-secondary">Latest · {formatDayKeyLong(r.latest.key)}</span>
                  </span>
                  <span className="text-[17px] font-semibold tnum text-text-primary">
                    {formatMetricWithUnit(r.metricId, r.latest.value, units)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}
