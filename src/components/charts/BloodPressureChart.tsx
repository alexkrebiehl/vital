'use client';

// ── Blood pressure: one chart, BOTH numbers ─────────────────────────────────
//
// A reading is a pair (111/71), so it is drawn as a pair: a systolic line, a
// diastolic line and a soft band between them, with a marker on every reading
// (readings are sparse). One tooltip states the full date and both numbers.
// Several readings on one day are separate points and separate tooltip rows,
// in time order; they are never averaged. A reading missing either number is
// not drawn. No threshold is drawn: the 120/80 reference is stated in words on
// the Health page, and this chart does not invent a presentation for it.

import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, Brush, CartesianGrid,
} from 'recharts';
import { formatMetricTick, formatMetricValue, formatBloodPressure, formatBloodPressureBreakdown, metricUnit } from '@/lib/metrics/format';
import type { BloodPressureObservation } from '@/lib/metrics/types';
import type { UnitSystem } from '@/lib/prefs';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { tooltipDateLabel } from '@/lib/analytics/axis-dates';
import { completeBloodPressureReadings, type BloodPressureBaseline } from '@/lib/analytics/bloodPressure';
import { useAxisDatePlan } from './useAxisDatePlan';

const BP = 'blood_pressure';
const SYSTOLIC_COLOR = 'var(--color-accent)';
const DIASTOLIC_COLOR = 'var(--color-category-recovery)';

export interface BloodPressureRow {
  /** Unique per reading, so two readings on one day are two points. */
  id: string;
  date: string;
  systolic: number;
  diastolic: number;
  /** [diastolic, systolic]: the shaded band between the two lines. */
  range: [number, number];
}

/** One row per complete reading, in the order given (oldest first). */
export function bloodPressureChartRows(records: BloodPressureObservation[]): BloodPressureRow[] {
  return completeBloodPressureReadings(records).map((r, i) => ({
    id: `${r.date}#${i}`,
    date: r.date,
    systolic: r.systolic,
    diastolic: r.diastolic,
    range: [r.diastolic, r.systolic],
  }));
}

export interface BloodPressureTooltipModel {
  date: string;
  entries: { id: string; pair: string; breakdown: string; hovered: boolean }[];
}

/** The hovered reading plus every other reading of the same day, in time order. */
export function bloodPressureTooltipModel(
  rows: BloodPressureRow[],
  hoveredId: string,
  units: UnitSystem = 'metric'
): BloodPressureTooltipModel | null {
  const hovered = rows.find(r => r.id === hoveredId);
  if (!hovered) return null;
  return {
    date: hovered.date,
    entries: rows
      .filter(r => r.date === hovered.date)
      .map(r => ({
        id: r.id,
        pair: formatBloodPressure(r.systolic, r.diastolic, units),
        breakdown: formatBloodPressureBreakdown(r.systolic, r.diastolic, units),
        hovered: r.id === hoveredId,
      })),
  };
}

export function BloodPressureTooltipBody({ model }: { model: BloodPressureTooltipModel }) {
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      {/* ALWAYS the full date, year included. */}
      <div className="text-text-secondary text-xs mb-1">{tooltipDateLabel(model.date)}</div>
      <ul className="list-none p-0 m-0 space-y-1.5">
        {model.entries.map(e => (
          <li key={e.id}>
            <div className={`tnum text-text-primary ${e.hovered ? 'font-semibold' : 'font-medium'}`}>{e.pair}</div>
            <div className="text-[10px] text-text-secondary tnum">{e.breakdown}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BloodPressureChartProps {
  records: BloodPressureObservation[];
  /** Mean ± spread of each series; drawn when `showBaseline` is on. */
  baseline?: BloodPressureBaseline | null;
  showBaseline?: boolean;
  height?: number;
  showBrush?: boolean;
  units?: UnitSystem;
  className?: string;
}

export function BloodPressureChart({
  records, baseline, showBaseline = false, height = 280, showBrush = false, units = 'metric', className = '',
}: BloodPressureChartProps) {
  const rows = bloodPressureChartRows(records);
  const unit = metricUnit(BP, units);
  const { ref, plan } = useAxisDatePlan(rows.map(r => r.date), { minTickGap: 40, reservedWidth: (unit ? 62 : 48) + 10 });
  if (rows.length === 0) return null;

  const byId = new Map(rows.map(r => [r.id, r]));
  const firstOfDay = new Set<string>();
  rows.forEach((r, i) => { if (i === 0 || rows[i - 1].date !== r.date) firstOfDay.add(r.id); });
  // A second reading on the same day shares its day's label, shown once.
  const tick = (id: string) => (firstOfDay.has(id) && byId.has(id) ? plan.label(byId.get(id)!.date) : '');
  const axisCommon = { tick: { fontSize: 11, fill: 'var(--color-text-secondary)' }, tickLine: false as const, axisLine: false as const };
  const lo = (f: (r: BloodPressureRow) => number) => formatMetricValue(BP, Math.min(...rows.map(f)), units);
  const hi = (f: (r: BloodPressureRow) => number) => formatMetricValue(BP, Math.max(...rows.map(f)), units);
  const summary =
    `Blood pressure chart${unit ? ` in ${unit}` : ''}, ${rows.length} reading${rows.length === 1 ? '' : 's'} from ` +
    `${formatDayKeyLong(rows[0].date)} to ${formatDayKeyLong(rows[rows.length - 1].date)}. ` +
    `Systolic ${lo(r => r.systolic)} to ${hi(r => r.systolic)}, diastolic ${lo(r => r.diastolic)} to ${hi(r => r.diastolic)}.`;

  const bands = showBaseline && baseline
    ? ([['systolic', SYSTOLIC_COLOR], ['diastolic', DIASTOLIC_COLOR]] as const).flatMap(([k, color]) => [
        <ReferenceArea key={`${k}-band`} y1={baseline[k].low} y2={baseline[k].high} fill={color} fillOpacity={0.07} stroke="none" />,
        <ReferenceLine
          key={`${k}-mean`}
          y={baseline[k].mean}
          stroke={color}
          strokeDasharray="4 4"
          strokeWidth={1}
          opacity={0.7}
          label={{
            value: `baseline ${k} ${formatMetricValue(BP, baseline[k].mean, units)}`,
            position: 'insideTopRight',
            style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
          }}
        />,
      ])
    : null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 mb-1 px-1">
        <span className="text-xs font-medium text-text-secondary">Blood Pressure</span>
        <span className="flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ background: SYSTOLIC_COLOR }} />Systolic</span>
          <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ background: DIASTOLIC_COLOR }} />Diastolic</span>
          {unit && <span className="tnum">y-axis: {unit}</span>}
        </span>
      </div>
      <div ref={ref} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis {...axisCommon} dataKey="id" interval="preserveStartEnd" minTickGap={40} tickFormatter={tick} />
            <YAxis
              {...axisCommon}
              width={unit ? 62 : 48}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => formatMetricTick(BP, v, units)}
              label={unit ? { value: unit, angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 10, fill: 'var(--color-text-secondary)' } } : undefined}
            />
            <Tooltip
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const model = bloodPressureTooltipModel(rows, String(payload[0]?.payload?.id), units);
                return model ? <BloodPressureTooltipBody model={model} /> : null;
              }}
            />
            {/* An array, not a fragment: recharts drops what is inside a React 19 fragment. */}
            {bands}
            <Area type="linear" dataKey="range" stroke="none" fill="var(--color-accent)" fillOpacity={0.12} activeDot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="systolic" stroke={SYSTOLIC_COLOR} strokeWidth={2} dot={{ r: 3, fill: SYSTOLIC_COLOR, strokeWidth: 0 }} activeDot={{ r: 5, fill: SYSTOLIC_COLOR }} isAnimationActive={false} />
            <Line type="linear" dataKey="diastolic" stroke={DIASTOLIC_COLOR} strokeWidth={2} dot={{ r: 3, fill: DIASTOLIC_COLOR, strokeWidth: 0 }} activeDot={{ r: 5, fill: DIASTOLIC_COLOR }} isAnimationActive={false} />
            {showBrush && rows.length > 60 ? (
              <Brush dataKey="id" height={32} travellerWidth={12} gap={1} stroke="var(--color-accent)" fill="var(--color-surface-muted)" tickFormatter={tick} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Accessible data table: two columns, not one value ───────────────────

export function BloodPressureDataTable({ records, units = 'metric' }: { records: BloodPressureObservation[]; units?: UnitSystem }) {
  const rows = bloodPressureChartRows(records);
  const unit = metricUnit(BP, units);
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Blood Pressure data table">
      <table className="w-full text-sm text-left">
        <caption className="text-left text-xs text-text-secondary mb-2">
          Blood Pressure — {rows.length} most recent reading{rows.length === 1 ? '' : 's'}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">Date</th>
            <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">Systolic</th>
            <th scope="col" className="py-2 font-medium text-text-secondary">Diastolic</th>
            <th scope="col" className="py-2 pl-4 font-medium text-text-secondary">Unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="py-1.5 pr-4 text-text-primary">{formatDayKeyLong(r.date)}</td>
              <td className="py-1.5 pr-4 tnum text-text-primary">{formatMetricValue(BP, r.systolic, units)}</td>
              <td className="py-1.5 tnum text-text-primary">{formatMetricValue(BP, r.diastolic, units)}</td>
              <td className="py-1.5 pl-4 text-text-secondary">{unit || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
