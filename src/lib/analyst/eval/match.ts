// ── Predicates on the calls of a question (design §12) ──────

import { resolveWindow } from '../capabilities/window';
import type { EvalCall, Pred } from './types';

/** "Today" of the evaluation set and its synthetic dataset. */
export const REF_KEY = '2026-10-08';

type Args = Record<string, unknown>;

/** Some call to `tool` whose arguments pass `check`. */
export const has =
  (tool: string, check: (a: Args) => boolean = () => true): Pred =>
  calls =>
    calls.some(c => c.tool === tool && check(c.args));

export const anyOf =
  (...preds: Pred[]): Pred =>
  calls =>
    preds.some(p => p(calls));

export const allOf =
  (...preds: Pred[]): Pred =>
  calls =>
    preds.every(p => p(calls));

export const always: Pred = () => true;

/** How many calls to `tool` pass `check`. */
export const count = (calls: readonly EvalCall[], tool: string, check: (a: Args) => boolean = () => true): number =>
  calls.filter(c => c.tool === tool && check(c.args)).length;

/** The days a `window` argument resolves to, or null when it does not resolve. */
export function span(window: unknown, fallbackDays = 30): { start: string; end: string } | null {
  const r = resolveWindow(window, { refKey: REF_KEY, defaultLastDays: fallbackDays });
  return r.ok ? { start: r.window.start, end: r.window.end } : null;
}

/** The window resolves to exactly start..end. */
export const winIs =
  (start: string, end: string) =>
  (a: Args): boolean => {
    const s = span(a.window);
    return s !== null && s.start === start && s.end === end;
  };

/** The window starts on `start` and ends on or after `end` (an open-ended "since"). */
export const winFrom =
  (start: string, end: string) =>
  (a: Args): boolean => {
    const s = span(a.window);
    return s !== null && s.start === start && s.end >= end;
  };

/** The window covers start..end and no more than `slack` days beyond either side. */
export const winCovers =
  (start: string, end: string, slack = 0) =>
  (a: Args): boolean => {
    const s = span(a.window);
    return s !== null && s.start <= start && s.end >= end && Date.parse(start) - Date.parse(s.start) <= slack * 86_400_000 && Date.parse(s.end) - Date.parse(end) <= slack * 86_400_000;
  };

/** The window is the last `n` days. */
export const lastDays = (n: number) => (a: Args): boolean => winIs(span({ lastDays: n })!.start, REF_KEY)(a);

/** A string argument matching `re`. */
export const text = (value: unknown, re: RegExp): boolean => typeof value === 'string' && re.test(value);

/** The metrics argument of get_metric_series lists a metric matching `re`. */
export const metric = (a: Args, re: RegExp): boolean => Array.isArray(a.metrics) && a.metrics.some(m => text(m, re));

/** The window spans at least `days` days. */
export const spansAtLeast =
  (days: number) =>
  (a: Args): boolean => {
    const s = span(a.window);
    return s !== null && Date.parse(s.end) - Date.parse(s.start) >= (days - 1) * 86_400_000;
  };

/** The get_app_data call for one capability, with a check on its params. */
export const app = (capability: string, check: (p: Args) => boolean = () => true): Pred =>
  has('get_app_data', a => a.capability === capability && check((a.params ?? {}) as Args));

/** A `compareTo` argument naming exactly start..end. */
export const compareIs = (a: Args, start: string, end: string): boolean => {
  const c = a.compareTo as { start?: unknown; end?: unknown } | undefined;
  return typeof c === 'object' && c !== null && c.start === start && c.end === end;
};
