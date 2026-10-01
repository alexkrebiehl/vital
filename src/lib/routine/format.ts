// ── Routine formatting ──────────────────────────────────
//
// Plain-text renderings of doses and performances for the routine UI, the
// narrative fact sheet and the analyst's tool results. Every load and distance
// goes through the shared unit conversion, so an imperial reader sees lb and mi.

import { convertValue, displayUnit } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import type { Dose, Range } from './types';

function trim(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.0+$/, '');
}

export function rangeText(r: Range, unit = ''): string {
  const body = r[0] === r[1] ? trim(r[0]) : `${trim(r[0])}–${trim(r[1])}`;
  return unit ? `${body}${unit}` : body;
}

export function weightText(kg: number, system: UnitSystem): string {
  const value = convertValue(kg, 'kg', system);
  const rounded = system === 'imperial' ? Math.round(value) : Math.round(value * 2) / 2;
  return `${trim(rounded)} ${displayUnit('kg', system)}`;
}

export function weightRangeText(r: Range, system: UnitSystem): string {
  if (r[0] === r[1]) return weightText(r[0], system);
  const a = weightText(r[0], system);
  const b = weightText(r[1], system);
  return `${a.split(' ')[0]}–${b}`;
}

export function distanceText(m: number, system: UnitSystem): string {
  const km = m / 1000;
  const value = convertValue(km, 'km', system);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${displayUnit('km', system)}`.replace(/\.?0+ /, ' ');
}

export function durationText(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m}:${String(rest).padStart(2, '0')} min` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Seconds per km → "5:35/km" or "8:59/mi". */
export function paceText(sPerKm: number, system: UnitSystem): string {
  const perUnit = system === 'imperial' ? sPerKm / 0.6213711922 : sPerKm;
  const m = Math.floor(perUnit / 60);
  const s = Math.round(perUnit % 60);
  return `${m}:${String(s).padStart(2, '0')}/${system === 'imperial' ? 'mi' : 'km'}`;
}

/** "3–4 × 8–12 per side @ RPE 7–9", "3 × 20–40 s hold", "20–22 km a week". */
export function doseText(dose: Dose | undefined, system: UnitSystem): string {
  if (!dose) return '';
  const parts: string[] = [];
  const sets = dose.sets ? rangeText(dose.sets) : null;
  let amount: string | null = null;
  if (dose.reps) amount = rangeText(dose.reps);
  else if (dose.holdS) amount = `${rangeText(dose.holdS)} s hold`;
  else if (dose.durationS) amount = dose.durationS[1] >= 90 ? `${rangeText([dose.durationS[0] / 60, dose.durationS[1] / 60])} min` : `${rangeText(dose.durationS)} s`;
  else if (dose.distanceM) amount = distanceText(dose.distanceM[0], system) === distanceText(dose.distanceM[1], system)
    ? distanceText(dose.distanceM[0], system)
    : `${distanceText(dose.distanceM[0], system).split(' ')[0]}–${distanceText(dose.distanceM[1], system)}`;
  if (sets && amount) parts.push(`${sets} × ${amount}`);
  else if (amount) parts.push(amount);
  else if (sets) parts.push(`${sets} sets`);
  if (dose.perSide) parts.push('per side');
  if (dose.eccentricS) parts.push(`with ${rangeText(dose.eccentricS)} s lowering`);
  if (dose.load?.kg) parts.push(`@ ${weightRangeText(dose.load.kg, system)}`);
  if (dose.load?.pct1rm) parts.push(`@ ${rangeText(dose.load.pct1rm)}% 1RM`);
  if (dose.load?.assistanceKg) parts.push(`with ${weightRangeText(dose.load.assistanceKg, system)} assistance`);
  if (dose.paceSPerKm) parts.push(`at ${paceText(dose.paceSPerKm[1], system)}–${paceText(dose.paceSPerKm[0], system)}`);
  if (dose.hrZone) parts.push(`zone ${rangeText(dose.hrZone)}`);
  if (dose.effort?.rpe) parts.push(`RPE ${rangeText(dose.effort.rpe)}`);
  else if (dose.effort?.rir) parts.push(`${rangeText(dose.effort.rir)} reps in reserve`);
  if (dose.weeklyVolume) {
    const r = dose.weeklyVolume.range;
    const v =
      dose.weeklyVolume.metric === 'distanceM'
        ? `${distanceText(r[0], system).split(' ')[0]}–${distanceText(r[1], system)}`
        : dose.weeklyVolume.metric === 'durationS'
          ? `${rangeText([Math.round(r[0] / 60), Math.round(r[1] / 60)])} min`
          : `${rangeText(r)} sets`;
    parts.push(`${v} a week`);
  }
  return parts.join(' ');
}
