// ── Body goal: display formatting ───────────────────────
//
// The engine works in kg, %, kcal and g; these turn its numbers into what the
// pages print, in the reader's units.

import { convertValue, displayUnit, toCanonicalValue } from '@/lib/metrics/format';
import type { UnitSystem } from '@/lib/prefs';
import { formatKg, formatSignedKg } from '@/lib/body-goal/report';
import type { Range } from '@/lib/body-goal/targets';
import type { TrendFit } from '@/lib/body-goal/pace';

export { formatKg, formatSignedKg };

export function weightUnit(units: UnitSystem): string {
  return displayUnit('kg', units);
}

/** kg → the number shown in an input, one decimal. */
export function kgToInput(kg: number, units: UnitSystem): number {
  return Math.round(convertValue(kg, 'kg', units) * 10) / 10;
}

/** A number typed in display units → kg. */
export function inputToKg(value: number, units: UnitSystem): number {
  return toCanonicalValue(value, 'kg', units);
}

export function formatRate(kgPerWeek: number, units: UnitSystem): string {
  return `${formatSignedKg(kgPerWeek, units)}/week`;
}

export function formatPct(pct: number, digits = 1): string {
  return `${pct.toFixed(digits)} %`;
}

export function formatKcal(kcal: number | null): string {
  return kcal === null || !Number.isFinite(kcal) ? '—' : `${Math.round(kcal).toLocaleString('en-US')} kcal`;
}

export function formatSignedKcal(kcal: number | null): string {
  if (kcal === null || !Number.isFinite(kcal)) return '—';
  const sign = kcal > 0 ? '+' : kcal < 0 ? '−' : '';
  return `${sign}${Math.abs(Math.round(kcal)).toLocaleString('en-US')} kcal`;
}

export function formatGrams(g: number | null): string {
  return g === null || !Number.isFinite(g) ? '—' : `${Math.round(g)} g`;
}

export function formatRange(range: Range | null, unit: 'kcal' | 'g'): string {
  if (!range) return '—';
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  return range.min === range.max ? `${n(range.min)} ${unit}` : `${n(range.min)}–${n(range.max)} ${unit}`;
}

export function formatWeeks(weeks: number): string {
  if (weeks < 1) return 'under a week';
  const n = Math.round(weeks);
  return `~${n} week${n === 1 ? '' : 's'}`;
}

/** The measured trend against the recommended band, in words. Descriptive, never a verdict. */
export const FIT_TEXT: Record<TrendFit, string> = {
  within: 'inside the recommended range',
  faster: 'faster than the recommended range',
  slower: 'slower than the recommended range',
  steady: 'holding steady',
  opposite: 'moving away from the target',
  drifting: 'drifting more than usual for maintenance',
  unknown: 'not enough weigh-ins for a trend yet',
};
