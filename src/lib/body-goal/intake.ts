// ── Body goal: intake by month, and against the targets ─
//
// The month table reads like a training log: how many days were logged, what
// an average logged day looked like, and protein per kg of body weight. Only
// complete logged days are averaged — unlogged days are absent, never zero, and
// partial logs are counted separately so a half-logged day does not drag a
// month's average down.

import { addDays } from '../analytics/windows';
import { mean } from '../analytics/stats';
import { TREND_DAYS } from './constants';
import { derivedFat } from './consistency';
import { splitLoggedDays } from './energy';
import type { NutritionTargets, Range } from './targets';
import { between, type DayValue } from './trend';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthIntake {
  month: string;
  label: string;
  from: string;
  to: string;
  loggedDays: number;
  completeDays: number;
  partialDays: number;
  kcal: number | null;
  protein: number | null;
  /** Protein per kg of the month's mean weight. */
  proteinPerKg: number | null;
  carbs: number | null;
  /** Reported fat. */
  fat: number | null;
  /** Fat derived from calories, protein and carbs. */
  derivedFat: number | null;
  fiber: number | null;
  /** Complete days at or above the protein floor. */
  daysAtProteinFloor: number | null;
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function meanOn(map: Map<string, number>, keys: string[]): number | null {
  const values = keys.map(k => map.get(k)).filter((v): v is number => v !== undefined);
  return values.length ? mean(values) : null;
}

export function monthlyIntake(
  series: (id: string) => DayValue[],
  today: string,
  options: { months?: number; proteinFloor?: number | null } = {}
): MonthIntake[] {
  const count = options.months ?? 6;
  // Today is still being logged; the table ends yesterday.
  const end = addDays(today, -1);
  const months: string[] = [end.slice(0, 7)];
  while (months.length < count) months.unshift(previousMonth(months[0]));
  const start = `${months[0]}-01`;

  const energy = between(series('dietary_energy'), start, end);
  const split = splitLoggedDays(energy);
  const partialKeys = new Set(split.partial.map(d => d.key));
  const map = (id: string) => new Map(between(series(id), start, end).map(p => [p.key, p.value]));
  const protein = map('dietary_protein');
  const carbs = map('dietary_carbs');
  const fat = map('dietary_fat_total');
  const fiber = map('dietary_fiber');
  const weights = between(series('weight_body_mass'), start, end);

  const rows: MonthIntake[] = [];
  for (const month of months) {
    const from = `${month}-01`;
    const to = monthEnd(month) < end ? monthEnd(month) : end;
    const logged = energy.filter(d => d.key >= from && d.key <= to);
    if (logged.length === 0) continue;
    const complete = logged.filter(d => !partialKeys.has(d.key)).map(d => d.key);
    const kcalMap = new Map(logged.map(d => [d.key, d.value]));
    const monthWeights = weights.filter(w => w.key >= from && w.key <= to).map(w => w.value);
    const weight = monthWeights.length ? mean(monthWeights) : null;
    const p = meanOn(protein, complete);
    const derived = complete
      .filter(k => protein.has(k) && carbs.has(k))
      .map(k => derivedFat(kcalMap.get(k)!, protein.get(k)!, carbs.get(k)!));
    const floor = options.proteinFloor ?? null;
    const [y, m] = month.split('-').map(Number);
    rows.push({
      month,
      label: `${MONTHS[m - 1]} ${y}`,
      from: logged[0].key,
      to: logged[logged.length - 1].key,
      loggedDays: logged.length,
      completeDays: complete.length,
      partialDays: logged.length - complete.length,
      kcal: meanOn(kcalMap, complete),
      protein: p,
      proteinPerKg: p !== null && weight !== null ? p / weight : null,
      carbs: meanOn(carbs, complete),
      fat: meanOn(fat, complete),
      derivedFat: derived.length ? mean(derived) : null,
      fiber: meanOn(fiber, complete),
      daysAtProteinFloor: floor === null ? null : complete.filter(k => (protein.get(k) ?? -1) >= floor).length,
    });
  }
  return rows;
}

/** One day of the adherence window, logged or not. */
export interface AdherenceDay {
  key: string;
  /** complete: counted; partial: logged but left out (see splitLoggedDays); none: nothing logged. */
  log: 'complete' | 'partial' | 'none';
  kcal: number | null;
  protein: number | null;
}

export interface Adherence {
  from: string;
  to: string;
  completeDays: number;
  partialDays: number;
  /** Complete days with calories inside the target range. */
  caloriesInRange: number | null;
  /** Outside the target range but inside the OK range. */
  caloriesOk: number | null;
  /** Above or below the OK range. */
  caloriesAbove: number | null;
  caloriesBelow: number | null;
  proteinAtFloor: number;
  /** Under the protein floor but at the OK floor or more. */
  proteinOk: number;
  proteinDays: number;
  fiberAtTarget: number | null;
  fiberDays: number;
  /** Every day of the window, oldest first, unlogged days included as gaps. */
  days: AdherenceDay[];
  /** Mean logged values over the complete days. */
  averages: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; derivedFat: number | null; fiber: number | null };
}

const inside = (v: number, r: Range) => v >= r.min && v <= r.max;

/** How one day's value sits against a target range: on it, near it, or off it. */
export type Verdict = 'met' | 'ok' | 'above' | 'below';

/** Calories against the target range and the wider OK range, as the Nutrition page judges a day. */
export function calorieVerdict(kcal: number, target: Range, okRange: Range = target): Verdict {
  return inside(kcal, target) ? 'met' : kcal > okRange.max ? 'above' : kcal < okRange.min ? 'below' : 'ok';
}

/** Protein against the floor and the OK floor, as the Nutrition page judges a day. */
export function proteinVerdict(grams: number, targets: Pick<NutritionTargets, 'proteinFloor' | 'proteinOkFloor'>): Exclude<Verdict, 'above'> {
  return grams >= targets.proteinFloor ? 'met' : grams >= targets.proteinOkFloor ? 'ok' : 'below';
}

/** The page's window: the four weeks ending yesterday. */
export function adherence(series: (id: string) => DayValue[], today: string, targets: NutritionTargets): Adherence {
  return adherenceBetween(series, addDays(today, -TREND_DAYS), addDays(today, -1), targets);
}

/** Adherence over any run of days (the last one should be a finished day: today is still being logged). */
export function adherenceBetween(series: (id: string) => DayValue[], from: string, to: string, targets: NutritionTargets): Adherence {
  const split = splitLoggedDays(between(series('dietary_energy'), from, to));
  const keys = split.complete.map(d => d.key);
  const kcal = new Map(split.complete.map(d => [d.key, d.value]));
  const map = (id: string) => new Map(between(series(id), from, to).map(p => [p.key, p.value]));
  const protein = map('dietary_protein');
  const carbs = map('dietary_carbs');
  const fat = map('dietary_fat_total');
  const fiber = map('dietary_fiber');
  const cal = targets.calories;
  const ok = targets.caloriesOk ?? cal;
  const proteinKeys = keys.filter(k => protein.has(k));
  const fiberKeys = keys.filter(k => fiber.has(k));
  const derived = keys.filter(k => protein.has(k) && carbs.has(k)).map(k => derivedFat(kcal.get(k)!, protein.get(k)!, carbs.get(k)!));
  const partial = new Map(split.partial.map(d => [d.key, d.value]));
  const days: AdherenceDay[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const log = kcal.has(key) ? 'complete' : partial.has(key) ? 'partial' : 'none';
    days.push({ key, log, kcal: kcal.get(key) ?? partial.get(key) ?? null, protein: log === 'none' ? null : protein.get(key) ?? null });
  }
  return {
    from,
    to,
    completeDays: keys.length,
    partialDays: split.partial.length,
    caloriesInRange: cal ? keys.filter(k => inside(kcal.get(k)!, cal)).length : null,
    caloriesOk: cal && ok ? keys.filter(k => !inside(kcal.get(k)!, cal) && inside(kcal.get(k)!, ok)).length : null,
    caloriesAbove: ok ? keys.filter(k => kcal.get(k)! > ok.max).length : null,
    caloriesBelow: ok ? keys.filter(k => kcal.get(k)! < ok.min).length : null,
    proteinAtFloor: proteinKeys.filter(k => protein.get(k)! >= targets.proteinFloor).length,
    proteinOk: proteinKeys.filter(k => protein.get(k)! < targets.proteinFloor && protein.get(k)! >= targets.proteinOkFloor).length,
    proteinDays: proteinKeys.length,
    fiberAtTarget: targets.fiber ? fiberKeys.filter(k => fiber.get(k)! >= targets.fiber!.min).length : null,
    fiberDays: fiberKeys.length,
    days,
    averages: {
      kcal: meanOn(kcal, keys),
      protein: meanOn(protein, keys),
      carbs: meanOn(carbs, keys),
      fat: meanOn(fat, keys),
      derivedFat: derived.length ? mean(derived) : null,
      fiber: meanOn(fiber, keys),
    },
  };
}
