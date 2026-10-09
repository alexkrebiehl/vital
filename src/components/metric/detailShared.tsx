'use client';

// Pieces the metric detail pages share: the single-number page and the paired
// blood pressure page read the same range tokens and draw the same cards.

import Link from 'next/link';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { trailingWindow, type DayWindow } from '@/lib/analytics';
import { getAllMetrics } from '@/lib/metrics';
import { Card } from '@/components/ui/primitives';
import { rangeDays } from '@/lib/ranges';

/** After the shared 7/30/90 presets and Custom: the long views this page also offers. */
export const RANGE_EXTRAS = [
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const RANGE_TOKENS = ['1y', 'all'];

/** A ?range= value the page can open at: a day count such as 45d, 1y, or all. */
export function isKnownRange(token: string | null): token is string {
  return token !== null && (RANGE_TOKENS.includes(token) || rangeDays(token, 'token') !== null);
}

export function RelatedMetricsList({ metrics }: { metrics: ReturnType<typeof getAllMetrics> }) {
  if (metrics.length === 0) return null;
  return (
    <section aria-label="Related metrics">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Related metrics</h3>
      <div className="flex flex-wrap gap-2">
        {metrics.map(m => (
          <Link
            key={m.id}
            href={`/metric/${m.id}`}
            className="px-3 py-1.5 text-xs font-medium bg-surface-muted text-text-secondary hover:text-text-primary hover:bg-surface border border-border rounded-control transition-colors"
          >
            {m.displayName}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function SummaryCard({ label, value, sub, highlight }: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`p-4 ${highlight ? 'ring-1 ring-category-attention/30' : ''}`}>
      <div className="mb-2 text-[12px] font-medium text-text-secondary">{label}</div>
      <div className={`mb-1.5 text-[22px] md:text-[26px] font-semibold tracking-[-0.03em] tnum ${highlight ? 'text-category-attention' : 'text-text-primary'} leading-none`}>
        {value}
      </div>
      <div className="text-[10px] text-text-secondary">{sub}</div>
    </Card>
  );
}

/** Resolve a range token to actual day-key bounds for the loaded series. */
export function actualRangeWindow(range: string, all: { key: string }[]): DayWindow {
  if (range === 'all') {
    const first = all[0]?.key ?? REFERENCE_KEY;
    return { startKey: first, endKey: REFERENCE_KEY, label: 'All time' };
  }
  const match = /^(\d+)d$/.exec(range);
  if (match) return trailingWindow(REFERENCE_KEY, Number(match[1]));
  if (range === '1y') return trailingWindow(REFERENCE_KEY, 365);
  return trailingWindow(REFERENCE_KEY, 90);
}