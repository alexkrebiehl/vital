'use client';

// ── Medication doses per recorded day ───────────────────────────────────────
//
// Follows `MetricChart.tsx` / `LabChart.tsx`: every fill is a CSS-variable token
// (so both themes are readable), ticks use the shared day-key formatter, the
// tooltip gives the full date and the per-status counts, and the figure is
// `role="img"` with a sentence a screen reader can read.
//
// WHAT THIS IS. A stacked bar per day the source actually logged something on:
// how many doses were recorded as Taken, Skipped and with no status. It is a
// record of what was logged, not an adherence score, a percentage or a target.
//
// WHAT IS DELIBERATELY NOT DRAWN. A day with no records has no bar at all: a
// missing day is a missing day, and drawing it as a zero-height bar would read
// as "zero doses" — a claim the data does not make.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import type { MedicationDayRow } from '@/lib/medications/view';

const SERIES = [
  { key: 'taken', label: 'Taken', color: 'var(--color-accent)' },
  { key: 'skipped', label: 'Skipped', color: 'var(--color-category-attention)' },
  { key: 'unknown', label: 'No status', color: 'var(--color-text-secondary)' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

interface TooltipPayload {
  dataKey?: string | number;
  value?: number | string;
}

function DosesTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = SERIES.map(series => ({
    label: series.label,
    color: series.color,
    value: Number(payload.find(p => p.dataKey === series.key)?.value ?? 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="bg-tooltip text-tooltip-foreground rounded-lg shadow-lg px-3 py-2 text-sm border border-border">
      <div className="text-xs opacity-80 mb-1">{label ? formatDayKeyLong(label) : ''}</div>
      {rows.map(row => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: row.color }} aria-hidden="true" />
          <span className="opacity-80">{row.label}</span>
          <span className="ml-auto tnum">{row.value}</span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-white/20 flex items-center gap-2">
        <span className="opacity-80">Recorded</span>
        <span className="ml-auto tnum">{total}</span>
      </div>
    </div>
  );
}

export function MedicationDoseChart({ rows }: { rows: MedicationDayRow[] }) {
  // The chart is only meaningful with something recorded on at least one day; the
  // caller hides the section when there is nothing to plot.
  if (rows.length === 0) return null;

  const days = rows.map(row => row.day);
  const total = rows.reduce((sum, row) => sum + row.taken + row.skipped + row.unknown, 0);
  const description =
    `Doses recorded on each of the ${rows.length} day${rows.length === 1 ? '' : 's'} that logged something, ` +
    `between ${formatDayKeyLong(days[0])} and ${formatDayKeyLong(days[days.length - 1])}: ` +
    SERIES.map(series => `${series.label} ${rows.reduce((sum, row) => sum + row[series.key as SeriesKey], 0)}`).join(', ') +
    `, ${total} in all. Days with no records are not drawn.`;

  return (
    <figure className="m-0">
      <div role="img" aria-label={description} className="w-full" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDayKeyShort}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<DosesTooltip />} cursor={{ fill: 'var(--color-surface-muted)' }} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)' }}
              iconType="circle"
              iconSize={8}
            />
            {SERIES.map(series => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                stackId="doses"
                fill={series.color}
                maxBarSize={26}
                // Every chart in Vital disables recharts' mount animation: a bar
                // that grows from zero on load reads as a value that was not
                // there, and a screenshot taken mid-animation shows an empty
                // plot. Matches MetricChart / LabChart / SleepStageChart.
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-[11px] text-text-secondary leading-relaxed">
        {description}
      </figcaption>
    </figure>
  );
}
