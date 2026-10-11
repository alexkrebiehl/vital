// ── Dashboard date specs: validate, resolve, label (pure, no React) ──────────
//
// docs/design/dashboard.md §5. `today` and `yesterday` are rolling and resolve
// from the app's reference day; `range` is two fixed day keys. Day keys are
// timezone-free strings, so a stored range never shifts.

import { MAX_CUSTOM_DAYS } from '@/lib/ranges';
import {
  addDays,
  diffDays,
  formatDayKeyLong,
  formatDayKeyShort,
  makeWindow,
  type DayWindow,
} from '@/lib/analytics/windows';
import type { DateSpec } from './types';

export type DateSpecResult = { ok: true; spec: DateSpec } | { ok: false; errors: string[] };

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['today', 'yesterday', 'range'];

function isRealDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false; // month 13, day 00: Date is invalid and toISOString throws
  }
}

function extraFields(input: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(input)
    .filter(k => !allowed.includes(k))
    .map(k => `The date has an unknown field "${k}".`);
}

export function validateDateSpec(input: unknown): DateSpecResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['The date must be an object with a kind.'] };
  }
  const obj = input as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    return { ok: false, errors: ['The date kind must be today, yesterday or range.'] };
  }
  if (kind === 'today' || kind === 'yesterday') {
    const extra = extraFields(obj, ['kind']);
    return extra.length ? { ok: false, errors: extra } : { ok: true, spec: { kind } };
  }

  const errors = extraFields(obj, ['kind', 'start', 'end']);
  const { start, end } = obj;
  if (!isRealDayKey(start)) {
    errors.push(
      typeof start === 'string' && KEY_PATTERN.test(start)
        ? 'The range start must be a real calendar date.'
        : 'The range start must be a day written YYYY-MM-DD.'
    );
  }
  if (!isRealDayKey(end)) {
    errors.push(
      typeof end === 'string' && KEY_PATTERN.test(end)
        ? 'The range end must be a real calendar date.'
        : 'The range end must be a day written YYYY-MM-DD.'
    );
  }
  if (errors.length) return { ok: false, errors };

  const s = start as string;
  const e = end as string;
  if (s > e) return { ok: false, errors: ['The range start must be on or before its end.'] };
  if (diffDays(s, e) + 1 > MAX_CUSTOM_DAYS) {
    return { ok: false, errors: [`A range can cover at most ${MAX_CUSTOM_DAYS} days.`] };
  }
  return { ok: true, spec: { kind: 'range', start: s, end: e } };
}

/** 'Today · Oct 8, 2026', 'Sep 1 – Sep 7, 2026', 'Dec 28, 2025 – Jan 3, 2026'. Always has a year. */
export function dateSpecLabel(spec: DateSpec, referenceKey: string): string {
  if (spec.kind === 'today') return `Today · ${formatDayKeyLong(referenceKey)}`;
  if (spec.kind === 'yesterday') return `Yesterday · ${formatDayKeyLong(addDays(referenceKey, -1))}`;
  if (spec.start === spec.end) return formatDayKeyLong(spec.start);
  const sameYear = spec.start.slice(0, 4) === spec.end.slice(0, 4);
  const first = sameYear ? formatDayKeyShort(spec.start) : formatDayKeyLong(spec.start);
  return `${first} – ${formatDayKeyLong(spec.end)}`;
}

export interface ResolvedDateSpec {
  window: DayWindow;
  kind: DateSpec['kind'];
  includesReferenceDay: boolean;
  /** The whole window lies after the reference day (start > reference). */
  afterReference: boolean;
  label: string;
}

export function resolveDateSpec(spec: DateSpec, referenceKey: string): ResolvedDateSpec {
  const label = dateSpecLabel(spec, referenceKey);
  let start: string;
  let end: string;
  if (spec.kind === 'today') {
    start = end = referenceKey;
  } else if (spec.kind === 'yesterday') {
    start = end = addDays(referenceKey, -1);
  } else {
    start = spec.start;
    end = spec.end;
  }
  return {
    window: makeWindow(start, end, label),
    kind: spec.kind,
    includesReferenceDay: start <= referenceKey && referenceKey <= end,
    afterReference: start > referenceKey,
    label,
  };
}

/** The `days`-day range ending on the reference day (the 7 / 30 / 90 quick picks). */
export function quickPickRange(days: number, referenceKey: string): Extract<DateSpec, { kind: 'range' }> {
  return { kind: 'range', start: addDays(referenceKey, -(days - 1)), end: referenceKey };
}
