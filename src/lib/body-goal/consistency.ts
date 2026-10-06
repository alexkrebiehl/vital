// ── Body goal: do the logged macros add up? ─────────────
//
// Protein and carbs carry 4 kcal/g and fat 9 kcal/g, so on a day with all four
// logged, 4P + 4C + 9F should land near the logged calories. When it does not,
// the usual cause is one food whose database entry is wrong — a decimal or
// unit slip that turns 8.5 g of fat into 85 g — and because people eat the same
// foods often, the same excess repeats day after day. That repeat is what this
// looks for. When enough days are affected, fat is DERIVED from the calories,
// (kcal − 4P − 4C) ÷ 9, and the pages say that they did so.

import { mean, median } from '../analytics/stats';
import { DERIVED_FAT_SHARE, KCAL_PER_G, MACRO_MISMATCH_KCAL } from './constants';
import { between, type DayValue } from './trend';

export interface MacroDay {
  key: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** 4P + 4C + 9F. */
  computed: number;
  /** computed − logged kcal. */
  diff: number;
  /** (kcal − 4P − 4C) ÷ 9, floored at zero. */
  derivedFat: number;
}

export interface MacroConsistency {
  from: string;
  to: string;
  checked: number;
  over: MacroDay[];
  under: MacroDay[];
  /** The repeated fat excess in grams, when one shows up. */
  recurringExcessFatG: number | null;
  /** True when enough days are off that the derived fat should be used instead of the reported one. */
  useDerivedFat: boolean;
  summary: string;
}

export function derivedFat(kcal: number, protein: number, carbs: number): number {
  return Math.max(0, (kcal - KCAL_PER_G.protein * protein - KCAL_PER_G.carbs * carbs) / KCAL_PER_G.fat);
}

export function macroDays(series: (id: string) => DayValue[], from: string, to: string): MacroDay[] {
  const map = (id: string) => new Map(between(series(id), from, to).map(p => [p.key, p.value]));
  const protein = map('dietary_protein');
  const carbs = map('dietary_carbs');
  const fat = map('dietary_fat_total');
  const out: MacroDay[] = [];
  for (const day of between(series('dietary_energy'), from, to)) {
    const p = protein.get(day.key);
    const c = carbs.get(day.key);
    const f = fat.get(day.key);
    if (p === undefined || c === undefined || f === undefined || day.value <= 0) continue;
    const computed = KCAL_PER_G.protein * p + KCAL_PER_G.carbs * c + KCAL_PER_G.fat * f;
    out.push({ key: day.key, kcal: day.value, protein: p, carbs: c, fat: f, computed, diff: computed - day.value, derivedFat: derivedFat(day.value, p, c) });
  }
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function macroConsistency(series: (id: string) => DayValue[], from: string, to: string): MacroConsistency {
  const days = macroDays(series, from, to);
  const over = days.filter(d => d.diff > MACRO_MISMATCH_KCAL);
  const under = days.filter(d => d.diff < -MACRO_MISMATCH_KCAL);

  let recurringExcessFatG: number | null = null;
  if (over.length >= 3) {
    const grams = over.map(d => d.diff / KCAL_PER_G.fat);
    const mid = median(grams);
    const close = grams.filter(g => Math.abs(g - mid) <= 12);
    if (close.length / grams.length >= 0.6) recurringExcessFatG = mean(close);
  }
  const useDerivedFat = days.length > 0 && over.length / days.length >= DERIVED_FAT_SHARE;

  let summary: string;
  if (days.length === 0) {
    summary = 'No day in this window has calories, protein, carbs and fat all logged, so the totals cannot be cross-checked.';
  } else if (over.length === 0 && under.length === 0) {
    summary = `On all ${plural(days.length, 'day')} with calories and all three macros logged, the macros add up to the calories (within ${MACRO_MISMATCH_KCAL} kcal).`;
  } else {
    const parts: string[] = [];
    if (recurringExcessFatG !== null) {
      parts.push(
        `On ${over.length} of ${plural(days.length, 'checked day')} the logged fat is about ${Math.round(recurringExcessFatG)} g more than the logged calories allow — roughly ${Math.round(recurringExcessFatG * KCAL_PER_G.fat)} kcal that appear nowhere in the calorie total. ` +
          'The same excess repeating usually means one food you log often has a wrong fat value in the food database (a decimal or unit slip).'
      );
    } else if (over.length > 0) {
      parts.push(`On ${over.length} of ${plural(days.length, 'checked day')} the macros add up to more than the logged calories.`);
    }
    if (under.length > 0) {
      parts.push(`On ${plural(under.length, 'day')} they add up to less (alcohol, or entries logged without macros, can do this).`);
    }
    if (useDerivedFat) parts.push('Fat on these pages is therefore derived from calories, protein and carbs.');
    summary = parts.join(' ');
  }

  return { from, to, checked: days.length, over, under, recurringExcessFatG, useDerivedFat, summary };
}
