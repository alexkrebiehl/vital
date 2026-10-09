// ── Display strings for the get_app_data reads ──────────────────────────────
//
// Values that are not registered metrics (calories, grams, ranges, a map's size)
// are formatted here once, in the same style the pages print them.

const n0 = (v: number): string => Math.round(v).toLocaleString('en-US');

export const kcal = (v: number): string => `${n0(v)} kcal`;
export const grams = (v: number): string => `${n0(v)} g`;

export function range(min: number, max: number, unit: 'kcal' | 'g'): string {
  return min === max ? `${n0(min)} ${unit}` : `${n0(min)}\u2013${n0(max)} ${unit}`;
}

/** A count with its noun and thousands separators: "120,000 observations". */
export const countOf = (n: number, noun: string): string => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

export const percent = (v: number, digits = 0): string => `${v.toFixed(digits)} %`;

/** A signed per-week figure, "+0.2 kg" or "-0.4 kg". */
export function signed(v: number, unit: string): string {
  return `${v > 0 ? '+' : ''}${v} ${unit}`;
}
