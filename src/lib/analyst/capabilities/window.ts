// ── Windows (design §7) ─────────────────────────────────
//
// Pure. Turns the one window object every time-bounded tool takes into a first
// and last day key, or into problems the model can fix. All date arithmetic is
// addDays / diffDays / trailingWindow from analytics/windows.

import { addDays, diffDays, trailingWindow } from '../../analytics/windows';
import type { Schema } from '../tools/args';

export const MAX_WINDOW_DAYS = 730;

export const WINDOW_SCHEMA: Schema & { type: 'object' } = {
  type: 'object',
  description: 'ONE of: day, month (YYYY-MM), start+end, lastDays. Days are YYYY-MM-DD.',
  properties: {
    day: { type: 'string' },
    month: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    lastDays: { type: 'integer', minimum: 1, maximum: MAX_WINDOW_DAYS },
  },
  additionalProperties: false,
};

export interface ResolvedWindow {
  /** Inclusive first day key. */
  start: string;
  /** Inclusive last day key. */
  end: string;
  /** The arguments as given, e.g. "month 2026-03". */
  asked: string;
  /** Present when the end was moved back to today. */
  clipped?: string;
}

export type WindowResult = { ok: true; window: ResolvedWindow } | { ok: false; problems: string[] };

export interface WindowOptions {
  refKey: string;
  defaultLastDays: number;
  maxDays?: number;
}

const FIELDS = ['day', 'month', 'start', 'end', 'lastDays'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for a real calendar day: it must survive a round trip through the date maths. */
function isRealDay(key: string): boolean {
  if (!DAY.test(key)) return false;
  try {
    return addDays(key, 0) === key;
  } catch {
    return false;
  }
}

function dayProblem(field: string, value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return `${field} must be a day as YYYY-MM-DD.`;
  return isRealDay(value) ? null : `${value} is not a real calendar day.`;
}

function monthBounds(month: string): { start: string; end: string } {
  const first = `${month}-01`;
  return { start: first, end: addDays(addDays(first, 31).slice(0, 8) + '01', -1) };
}

export function resolveWindow(input: unknown, options: WindowOptions): WindowResult {
  const maxDays = options.maxDays ?? MAX_WINDOW_DAYS;
  const { refKey } = options;

  if (input === undefined || input === null) return fromLastDays(options.defaultLastDays, `lastDays ${options.defaultLastDays} (default)`, refKey);
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, problems: ['window must be an object, e.g. { "lastDays": 30 } or { "month": "2026-03" }.'] };

  const given = input as Record<string, unknown>;
  const unknown = Object.keys(given).filter(k => !(FIELDS as readonly string[]).includes(k) && given[k] !== undefined);
  if (unknown.length) return { ok: false, problems: unknown.map(k => `${k} is not an accepted window field (day, month, start+end, lastDays).`) };

  const has = (k: (typeof FIELDS)[number]) => given[k] !== undefined;
  if (!FIELDS.some(has)) return fromLastDays(options.defaultLastDays, `lastDays ${options.defaultLastDays} (default)`, refKey);

  const forms = [has('day') && 'day', has('month') && 'month', (has('start') || has('end')) && 'start+end', has('lastDays') && 'lastDays'].filter(Boolean) as string[];
  if (forms.length > 1) return { ok: false, problems: [`Give only one of day, month, start+end or lastDays; got ${forms.join(' and ')}.`] };

  if (has('lastDays')) {
    const n = given.lastDays;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > maxDays) return { ok: false, problems: [`lastDays must be a whole number from 1 to ${maxDays}.`] };
    return fromLastDays(n, `lastDays ${n}`, refKey);
  }

  let start: string;
  let end: string;
  let asked: string;
  if (has('day')) {
    const p = dayProblem('day', given.day);
    if (p) return { ok: false, problems: [p] };
    start = end = given.day as string;
    asked = `day ${start}`;
  } else if (has('month')) {
    const m = given.month;
    if (typeof m !== 'string' || !MONTH.test(m)) return { ok: false, problems: ['month must be YYYY-MM, e.g. 2026-03.'] };
    ({ start, end } = monthBounds(m));
    asked = `month ${m}`;
  } else {
    if (!has('start') || !has('end')) return { ok: false, problems: ['start and end go together: give both, or use day, month or lastDays.'] };
    const problems = [dayProblem('start', given.start), dayProblem('end', given.end)].filter((p): p is string => p !== null);
    if (problems.length) return { ok: false, problems };
    start = given.start as string;
    end = given.end as string;
    if (start > end) return { ok: false, problems: [`start ${start} is after end ${end}.`] };
    asked = `start ${start}, end ${end}`;
  }

  const span = diffDays(start, end) + 1;
  if (span > maxDays) return { ok: false, problems: [`The window spans ${span} days; a window may span at most ${maxDays}.`] };
  if (start > refKey) return { ok: false, problems: [`${start} is after today, ${refKey}`] };
  if (end > refKey) {
    return { ok: true, window: { start, end: refKey, asked, clipped: `The window asked for ended ${end}; it was clipped to today, ${refKey}.` } };
  }
  return { ok: true, window: { start, end, asked } };
}

function fromLastDays(n: number, asked: string, refKey: string): WindowResult {
  const w = trailingWindow(refKey, n);
  return { ok: true, window: { start: w.startKey, end: w.endKey, asked } };
}
