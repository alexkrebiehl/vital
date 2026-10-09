import { describe, expect, it } from 'vitest';
import { dateSpecLabel, quickPickRange, resolveDateSpec, validateDateSpec } from './date-spec';
import { MAX_CUSTOM_DAYS } from '@/lib/ranges';
import { addDays } from '@/lib/analytics/windows';

const ok = (input: unknown) => {
  const r = validateDateSpec(input);
  expect(r.ok).toBe(true);
  return r.ok ? r.spec : null;
};
const bad = (input: unknown) => {
  const r = validateDateSpec(input);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
};

describe('validateDateSpec', () => {
  it('accepts today, yesterday and a range', () => {
    expect(ok({ kind: 'today' })).toEqual({ kind: 'today' });
    expect(ok({ kind: 'yesterday' })).toEqual({ kind: 'yesterday' });
    expect(ok({ kind: 'range', start: '2026-09-01', end: '2026-09-07' })).toEqual({ kind: 'range', start: '2026-09-01', end: '2026-09-07' });
  });

  it('accepts a one-day range and the longest allowed span', () => {
    ok({ kind: 'range', start: '2026-09-01', end: '2026-09-01' });
    ok({ kind: 'range', start: '2016-10-10', end: addDays('2016-10-10', MAX_CUSTOM_DAYS - 1) });
  });

  it('refuses a non-object, null, an array and an unknown kind', () => {
    for (const input of [null, undefined, 'today', 3, [], { kind: 'tomorrow' }, {}]) {
      expect(bad(input).length).toBeGreaterThan(0);
    }
  });

  it('refuses an extra field on every kind', () => {
    expect(bad({ kind: 'today', extra: 1 })[0]).toMatch(/extra/);
    expect(bad({ kind: 'yesterday', start: '2026-09-01' })[0]).toMatch(/start/);
    expect(bad({ kind: 'range', start: '2026-09-01', end: '2026-09-02', tz: 'UTC' })[0]).toMatch(/tz/);
  });

  it('refuses a range with a missing or malformed key', () => {
    bad({ kind: 'range', start: '2026-09-01' });
    bad({ kind: 'range', end: '2026-09-01' });
    bad({ kind: 'range', start: '2026-9-1', end: '2026-09-02' });
    bad({ kind: 'range', start: '2026-09-01', end: 20260902 });
    bad({ kind: 'range', start: '2026-09-01T00:00:00Z', end: '2026-09-02' });
  });

  it('refuses a date that does not exist (2026-02-30 rolls over to 2026-03-02)', () => {
    expect(bad({ kind: 'range', start: '2026-02-30', end: '2026-03-05' })[0]).toMatch(/real calendar date/);
    bad({ kind: 'range', start: '2026-03-01', end: '2026-13-01' });
    bad({ kind: 'range', start: '2026-04-31', end: '2026-05-01' });
  });

  it('accepts a real leap day and refuses a fake one', () => {
    ok({ kind: 'range', start: '2028-02-29', end: '2028-03-01' });
    bad({ kind: 'range', start: '2026-02-29', end: '2026-03-01' });
  });

  it('refuses a start after the end', () => {
    expect(bad({ kind: 'range', start: '2026-09-08', end: '2026-09-07' })[0]).toMatch(/on or before/);
  });

  it('refuses a span over the custom-range cap', () => {
    const errors = bad({ kind: 'range', start: '2016-10-10', end: addDays('2016-10-10', MAX_CUSTOM_DAYS) });
    expect(errors[0]).toContain(String(MAX_CUSTOM_DAYS));
  });
});

describe('resolveDateSpec', () => {
  it('today is the reference day', () => {
    const r = resolveDateSpec({ kind: 'today' }, '2026-10-08');
    expect(r.window).toMatchObject({ startKey: '2026-10-08', endKey: '2026-10-08' });
    expect(r.kind).toBe('today');
    expect(r.includesReferenceDay).toBe(true);
    expect(r.afterReference).toBe(false);
    expect(r.label).toBe('Today · Oct 8, 2026');
  });

  it('yesterday crosses a month and a year end', () => {
    expect(resolveDateSpec({ kind: 'yesterday' }, '2026-10-08').window).toMatchObject({ startKey: '2026-10-07', endKey: '2026-10-07' });
    expect(resolveDateSpec({ kind: 'yesterday' }, '2026-11-01').window.startKey).toBe('2026-10-31');
    const y = resolveDateSpec({ kind: 'yesterday' }, '2027-01-01');
    expect(y.window).toMatchObject({ startKey: '2026-12-31', endKey: '2026-12-31' });
    expect(y.includesReferenceDay).toBe(false);
    expect(y.label).toBe('Yesterday · Dec 31, 2026');
  });

  it('today on a leap day and the day after', () => {
    expect(resolveDateSpec({ kind: 'yesterday' }, '2028-03-01').window.startKey).toBe('2028-02-29');
  });

  it('a range is exactly as stored, with no clipping', () => {
    const r = resolveDateSpec({ kind: 'range', start: '2026-09-01', end: '2026-12-31' }, '2026-10-08');
    expect(r.window).toMatchObject({ startKey: '2026-09-01', endKey: '2026-12-31' });
    expect(r.includesReferenceDay).toBe(true);
    expect(r.afterReference).toBe(false);
  });

  it('a past range does not include the reference day', () => {
    const r = resolveDateSpec({ kind: 'range', start: '2026-09-01', end: '2026-09-07' }, '2026-10-08');
    expect(r.includesReferenceDay).toBe(false);
    expect(r.afterReference).toBe(false);
  });

  it('a range ending on the reference day, and one starting on it, include it', () => {
    expect(resolveDateSpec({ kind: 'range', start: '2026-10-02', end: '2026-10-08' }, '2026-10-08').includesReferenceDay).toBe(true);
    const r = resolveDateSpec({ kind: 'range', start: '2026-10-08', end: '2026-10-10' }, '2026-10-08');
    expect(r.includesReferenceDay).toBe(true);
    expect(r.afterReference).toBe(false);
  });

  it('a range wholly after the reference day is flagged', () => {
    const r = resolveDateSpec({ kind: 'range', start: '2026-10-09', end: '2026-10-12' }, '2026-10-08');
    expect(r.afterReference).toBe(true);
    expect(r.includesReferenceDay).toBe(false);
  });

  it('the window label equals the date label', () => {
    const r = resolveDateSpec({ kind: 'range', start: '2026-09-01', end: '2026-09-07' }, '2026-10-08');
    expect(r.window.label).toBe(r.label);
  });
});

describe('dateSpecLabel', () => {
  it('names the day and always carries a year', () => {
    expect(dateSpecLabel({ kind: 'today' }, '2026-10-08')).toBe('Today · Oct 8, 2026');
    expect(dateSpecLabel({ kind: 'yesterday' }, '2026-10-08')).toBe('Yesterday · Oct 7, 2026');
  });

  it('a same-year range shows the year once, at the end', () => {
    expect(dateSpecLabel({ kind: 'range', start: '2026-09-01', end: '2026-09-07' }, '2026-10-08')).toBe('Sep 1 – Sep 7, 2026');
  });

  it('a range across years shows both years', () => {
    expect(dateSpecLabel({ kind: 'range', start: '2025-12-28', end: '2026-01-03' }, '2026-10-08')).toBe('Dec 28, 2025 – Jan 3, 2026');
  });

  it('a one-day range is a single date with a year', () => {
    expect(dateSpecLabel({ kind: 'range', start: '2026-09-01', end: '2026-09-01' }, '2026-10-08')).toBe('Sep 1, 2026');
  });

  it('every label contains a four-digit year', () => {
    const specs = [
      { kind: 'today' as const },
      { kind: 'yesterday' as const },
      { kind: 'range' as const, start: '2026-09-01', end: '2026-09-07' },
      { kind: 'range' as const, start: '2025-12-28', end: '2026-01-03' },
      { kind: 'range' as const, start: '2026-09-01', end: '2026-09-01' },
    ];
    for (const s of specs) expect(dateSpecLabel(s, '2026-10-08')).toMatch(/\b\d{4}\b/);
  });
});

describe('quickPickRange', () => {
  it('7 days ending on the reference day', () => {
    expect(quickPickRange(7, '2026-10-08')).toEqual({ kind: 'range', start: '2026-10-02', end: '2026-10-08' });
  });

  it('30 and 90 days, across month and year ends', () => {
    expect(quickPickRange(30, '2026-10-08')).toEqual({ kind: 'range', start: '2026-09-09', end: '2026-10-08' });
    expect(quickPickRange(90, '2026-02-01')).toEqual({ kind: 'range', start: '2025-11-04', end: '2026-02-01' });
  });

  it('a quick pick is itself a valid spec', () => {
    for (const d of [7, 30, 90]) ok(quickPickRange(d, '2026-10-08'));
  });
});
