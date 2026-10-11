'use client';

// ── Trends: blood pressure as a pair ────────────────────────────────────────
//
// Blood pressure has no single series, so the generic aligned chart and the
// single-number comparison table cannot carry it. These two pieces do: a paired
// chart over the shared window, and a comparison with one row per series
// (systolic, diastolic), each its own average and its own change.

import { bloodPressureSeries } from '@/lib/adapters/dataset';
import { bloodPressureInWindow, bloodPressureStats, windowRangeLabel, type DayWindow } from '@/lib/analytics';
import { formatDeltaWithUnit, formatMetricWithUnit } from '@/lib/metrics/format';
import type { UnitSystem } from '@/lib/prefs';
import { BloodPressureChart } from '@/components/charts';
import { Card, DataStateNote } from '@/components/ui/primitives';
import { SectionTitle } from './DomainShared';

const BP = 'blood_pressure';

export function BloodPressureAligned({
  window, units, showXAxis,
}: { window: DayWindow; units: UnitSystem; showXAxis: boolean }) {
  const records = bloodPressureInWindow(bloodPressureSeries(), window);
  // No reading in the window ⇒ no chart at all.
  if (records.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1">Blood Pressure · {records.length} readings</p>
      <BloodPressureChart records={records} units={units} height={showXAxis ? 200 : 150} showBrush={showXAxis && records.length > 60} />
      {!showXAxis && (
        <p className="text-[10px] text-text-secondary mt-1">x-axis labels are shown once, on the final chart</p>
      )}
    </div>
  );
}

export function BloodPressureComparison({
  evaluated, comparator, units,
}: { evaluated: DayWindow; comparator: DayWindow; units: UnitSystem }) {
  const all = bloodPressureSeries();
  const now = bloodPressureStats(bloodPressureInWindow(all, evaluated));
  const before = bloodPressureStats(bloodPressureInWindow(all, comparator));
  if (!now && !before) return null;
  const rows = (['systolic', 'diastolic'] as const).map(k => ({
    label: k === 'systolic' ? 'Systolic' : 'Diastolic',
    now: now ? formatMetricWithUnit(BP, now[k].mean, units) : 'Not enough data',
    before: before ? formatMetricWithUnit(BP, before[k].mean, units) : 'Not enough data',
    change: now && before ? formatDeltaWithUnit(BP, now[k].mean - before[k].mean, units) : '—',
  }));
  return (
    <section>
      <SectionTitle hint={`${windowRangeLabel(evaluated)} vs ${windowRangeLabel(comparator)}`}>Blood pressure</SectionTitle>
      <Card className="p-4 md:p-6">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Blood pressure comparison table">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Average systolic and diastolic blood pressure in two periods</caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Series</th>
                <th scope="col" className="py-2 pr-4 font-medium">This period</th>
                <th scope="col" className="py-2 pr-4 font-medium">Comparator</th>
                <th scope="col" className="py-2 pr-4 font-medium">Change</th>
                <th scope="col" className="py-2 font-medium">Readings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-b border-border/50">
                  <td className="py-2.5 pr-4 text-text-primary">{r.label}</td>
                  <td className="py-2.5 pr-4 tnum text-text-primary">{r.now}</td>
                  <td className="py-2.5 pr-4 tnum text-text-primary">{r.before}</td>
                  <td className="py-2.5 pr-4 tnum text-text-primary">{r.change}</td>
                  <td className="py-2.5 text-[11px] text-text-secondary tnum">{now?.count ?? 0} vs {before?.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <DataStateNote>
            Each series is averaged over its own readings and compared on its own; the two numbers of a reading are
            never combined into one.
          </DataStateNote>
        </div>
      </Card>
    </section>
  );
}
