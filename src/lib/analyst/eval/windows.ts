// ── Windows the evaluation questions expect (refKey 2026-10-08) ──

import { REF_KEY, lastDays, winFrom, winIs } from './match';

export const YEAR = (a: Record<string, unknown>): boolean => winFrom('2026-01-01', REF_KEY)(a) || lastDays(365)(a);
export const MAR = winIs('2026-03-01', '2026-03-31');
export const SEP = winIs('2026-09-01', '2026-09-30');
export const AUG_SEP = [
  ['2026-08', winIs('2026-08-01', '2026-08-31')],
  ['2026-09', SEP],
] as const;
/** The weeks of Sept 22 and Sept 29, seven days each. */
export const W1 = ['2026-09-22', '2026-09-28'] as const;
export const W2 = ['2026-09-29', '2026-10-05'] as const;
/** The dates of the last two lab panels of the synthetic labs. */
export const PANELS = ['2026-06-15', '2026-09-29'] as const;
