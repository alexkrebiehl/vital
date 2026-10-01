'use client';

import { seriesFor } from '@/lib/adapters/dataset';
import { formatDayKeyLong } from '@/lib/analytics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import { useUnits } from '@/components/ui/UnitsProvider';

/**
 * Weight split into fat mass and everything else, from the latest weight and the
 * latest body-fat percentage. Fat mass is weight × body-fat %, so it is a
 * derived figure and is labelled as one. Renders nothing unless both readings
 * exist; the two readings may be from different days, and the dates say so.
 */
export function CompositionBar() {
  const { units } = useUnits();
  const w = seriesFor('weight_body_mass').at(-1);
  const f = seriesFor('body_fat_percentage').at(-1);
  if (!w || !f || !(w.value > 0) || !(f.value >= 0 && f.value <= 100)) return null;

  const fat = (w.value * f.value) / 100;
  const rest = w.value - fat;
  const sameDay = w.key === f.key;

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted" role="img"
        aria-label={`Of ${formatMetricWithUnit('weight_body_mass', w.value, units)}, about ${f.value.toFixed(1)} percent is fat`}>
        <div style={{ width: `${100 - f.value}%`, background: 'var(--color-category-activity)' }} />
        <div style={{ width: `${f.value}%`, background: 'var(--color-category-nutrition)' }} className="border-l-2 border-surface" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="flex items-center gap-2 text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-category-activity)' }} />
            Not fat
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tnum tracking-tight text-text-primary">
            {formatMetricWithUnit('weight_body_mass', rest, units)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-2 text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-category-nutrition)' }} />
            Fat mass
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tnum tracking-tight text-text-primary">
            {formatMetricWithUnit('weight_body_mass', fat, units)}
            <span className="ml-1.5 text-sm font-normal text-text-secondary">{f.value.toFixed(1)}%</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-text-secondary">
        Fat mass is the latest weight multiplied by the latest body-fat percentage, so it is calculated, not measured.{' '}
        {sameDay
          ? `Both readings are from ${formatDayKeyLong(w.key)}.`
          : `Weight is from ${formatDayKeyLong(w.key)} and body fat from ${formatDayKeyLong(f.key)}.`}
      </p>
    </div>
  );
}
