// ── A lab window (pure) ─────────────────────────────────────────────────────
//
// Observations are dated by the day they were measured (`on`). A window keeps the
// ones inside it. A series with none inside is not dropped: the caller names it, so
// "nothing measured in this window" can never be read as "this analyte is unknown".

import type { LabSeriesInput } from '../../labSnapshot';
import type { ResolvedWindow } from '../window';

/** The most names notInWindow lists before it says how many more there are. */
export const MAX_NOT_IN_WINDOW = 40;

/** Every series, with only the observations inside the window; a series with none keeps an empty list. */
export function labInWindow(series: LabSeriesInput[], w: Pick<ResolvedWindow, 'start' | 'end'>): LabSeriesInput[] {
  return series.map(s => ({ ...s, points: s.points.filter(p => p.on >= w.start && p.on <= w.end) }));
}

/** The names of series with nothing in the window, capped, with the overflow counted in words. */
export function namesNotInWindow(empty: LabSeriesInput[]): string[] {
  const names = empty.map(s => s.displayName);
  if (names.length <= MAX_NOT_IN_WINDOW) return names;
  return [...names.slice(0, MAX_NOT_IN_WINDOW), `and ${names.length - MAX_NOT_IN_WINDOW} more`];
}
