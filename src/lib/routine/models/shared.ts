// ── Helpers shared by the progression models ────────────

import type { UnitSystem } from '../../prefs';
import { distanceText, weightText } from '../format';
import type { PerformanceRecord, WorkingSet } from '../records';
import type { Dose, Range } from '../types';
import type { ProgressRow } from './types';

/** What a set is measured by for a given dose. */
export type Quantity = 'reps' | 'durationS' | 'distanceM';

export function quantityFor(dose: Dose | undefined, records: PerformanceRecord[]): Quantity {
  if (dose?.reps) return 'reps';
  if (dose?.holdS || dose?.durationS) return 'durationS';
  if (dose?.distanceM) return 'distanceM';
  const any = records.flatMap(r => r.sets);
  if (any.some(s => s.reps !== undefined)) return 'reps';
  if (any.some(s => s.durationS !== undefined)) return 'durationS';
  return 'distanceM';
}

export function targetRange(dose: Dose | undefined, q: Quantity): Range | undefined {
  if (!dose) return undefined;
  if (q === 'reps') return dose.reps;
  if (q === 'durationS') return dose.holdS ?? dose.durationS;
  return dose.distanceM;
}

export function setValue(set: WorkingSet, q: Quantity): number | undefined {
  return set[q];
}

export function valuesOf(record: PerformanceRecord, q: Quantity): number[] {
  return record.sets.map(s => setValue(s, q)).filter((v): v is number => v !== undefined);
}

export function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function rpesOf(record: PerformanceRecord): number[] {
  return record.sets.map(s => s.rpe).filter((v): v is number => v !== undefined);
}

export function effortText(record: PerformanceRecord): string | null {
  const rpes = rpesOf(record);
  if (rpes.length === 0) return null;
  const lo = Math.min(...rpes);
  const hi = Math.max(...rpes);
  return lo === hi ? `RPE ${lo}` : `RPE ${lo}–${hi}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/** "12/12/10", "60/55/50 s", "8.02 km". */
export function valuesText(values: number[], q: Quantity, system: UnitSystem): string {
  if (q === 'distanceM') return values.map(v => distanceText(v, system)).join(' + ');
  const body = values.map(fmt).join('/');
  return q === 'durationS' ? `${body} s` : body;
}

/** " @ 30 kg assistance", " @ 10 kg", or "" for unloaded work. */
export function loadSuffix(record: PerformanceRecord, system: UnitSystem): string {
  const w = record.totals.topWeightKg;
  if (w === null || w <= 0) return '';
  return record.loadMeaning === 'assistance' ? ` @ ${weightText(w, system)} assistance` : ` @ ${weightText(w, system)}`;
}

export function headlineOf(values: number[], q: Quantity, system: UnitSystem): string {
  const total = sumOf(values);
  if (q === 'reps') return `${fmt(total)} reps`;
  if (q === 'durationS') return `${fmt(total)} s`;
  return distanceText(total, system);
}

/**
 * Merge consecutive rows whose work is identical ("08-24 / 08-27 · 15/12/9"),
 * except a row flagged `keep` (the last session before a stage change).
 */
export function mergeRows(rows: (ProgressRow & { keep?: boolean })[]): ProgressRow[] {
  const out: (ProgressRow & { keep?: boolean; base?: string })[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev && !row.keep && !prev.keep && prev.work === row.work && prev.stageId === row.stageId) {
      prev.dates.push(...row.dates);
      prev.sessionIds.push(...row.sessionIds);
      if (row.effort && row.effort !== prev.effort) prev.effort = row.effort;
      if (row.notes) prev.notes = row.notes;
      prev.base ??= prev.signal;
      prev.signal = `${prev.base} · ${prev.dates.length} sessions`;
      continue;
    }
    out.push({ ...row, dates: [...row.dates], sessionIds: [...row.sessionIds] });
  }
  return out.map(({ keep: _keep, base: _base, ...row }) => row);
}

/** Signal from the change in a headline total versus the previous session. */
export function trendSignal(total: number, previous: number | null, best: number): string {
  if (previous === null) return 'First logged session';
  if (previous <= 0) return total > 0 ? 'Continued progression' : 'Holding';
  const change = (total - previous) / previous;
  if (total > previous && change >= 0.15) return 'Rapid volume increase';
  if (total > previous) return total >= best ? 'New best' : 'Continued progression';
  if (total === previous) return total >= best ? 'Repeated best' : 'Holding';
  if (change <= -0.1) return 'Regression';
  return 'Slight dip';
}

/** True when the last `n` sessions each fell versus the one before by more than `pct`. */
export function fallingStreak(totals: number[], n = 2, pct = 0.05): boolean {
  if (totals.length < n + 1) return false;
  for (let i = totals.length - n; i < totals.length; i++) {
    if (!(totals[i] < totals[i - 1] * (1 - pct))) return false;
  }
  return true;
}

export function readinessLabel(q: number, range: Range, unit: 'sessions' | 'weeks'): string {
  const needed = range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`;
  return `${q} of ${needed} qualifying ${unit === 'weeks' ? 'weeks' : 'sessions'}`;
}
