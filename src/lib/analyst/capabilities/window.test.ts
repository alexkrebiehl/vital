// ── Window parsing (design §7) ──────────────────────────
import { describe, expect, it } from 'vitest';
import { resolveWindow, WINDOW_SCHEMA, type WindowOptions } from './window';
import { checkArgs } from '../tools/args';

const REF = '2026-10-08';
const opts: WindowOptions = { refKey: REF, defaultLastDays: 30 };

function win(input: unknown, o = opts) {
  const r = resolveWindow(input, o);
  if (!r.ok) throw new Error(`expected ok, got: ${r.problems.join(' | ')}`);
  return r.window;
}
function problems(input: unknown, o = opts): string[] {
  const r = resolveWindow(input, o);
  if (r.ok) throw new Error(`expected problems, got ${JSON.stringify(r.window)}`);
  return r.problems;
}

describe('resolveWindow', () => {
  it('uses the default trailing window when nothing is given', () => {
    expect(win(undefined)).toEqual({ start: '2026-09-09', end: REF, asked: 'lastDays 30 (default)' });
    expect(win({})).toEqual({ start: '2026-09-09', end: REF, asked: 'lastDays 30 (default)' });
  });

  it('resolves lastDays through trailingWindow', () => {
    expect(win({ lastDays: 7 })).toEqual({ start: '2026-10-02', end: REF, asked: 'lastDays 7' });
    expect(win({ lastDays: 1 })).toEqual({ start: REF, end: REF, asked: 'lastDays 1' });
  });

  it('resolves one day', () => {
    expect(win({ day: '2026-03-05' })).toEqual({ start: '2026-03-05', end: '2026-03-05', asked: 'day 2026-03-05' });
  });

  it('resolves a month to its first and last day, including leap February and December', () => {
    expect(win({ month: '2026-03' })).toMatchObject({ start: '2026-03-01', end: '2026-03-31', asked: 'month 2026-03' });
    expect(win({ month: '2026-02' })).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(win({ month: '2024-02' })).toMatchObject({ start: '2024-02-01', end: '2024-02-29' });
    expect(win({ month: '2025-12' })).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('resolves start and end, inclusive, and echoes what was asked', () => {
    expect(win({ start: '2026-01-01', end: '2026-01-31' })).toEqual({ start: '2026-01-01', end: '2026-01-31', asked: 'start 2026-01-01, end 2026-01-31' });
  });

  it('refuses a date that does not exist', () => {
    expect(problems({ day: '2026-02-30' })[0]).toMatch(/2026-02-30 is not a real calendar day/);
    expect(problems({ day: '2026-13-01' })[0]).toMatch(/not a real calendar day/);
  });

  it('accepts 2024-02-29 and refuses 2026-02-29', () => {
    expect(win({ day: '2024-02-29' }).start).toBe('2024-02-29');
    expect(problems({ day: '2026-02-29' })[0]).toMatch(/2026-02-29 is not a real calendar day/);
  });

  it('refuses a malformed day or month', () => {
    expect(problems({ day: '03/05/2026' })[0]).toMatch(/YYYY-MM-DD/);
    expect(problems({ month: '2026-3' })[0]).toMatch(/YYYY-MM/);
    expect(problems({ month: '2026-13' })[0]).toMatch(/YYYY-MM/);
  });

  it('allows a span of 730 days and refuses 731', () => {
    expect(win({ start: '2024-10-09', end: '2026-10-08' }).start).toBe('2024-10-09');
    expect(problems({ start: '2024-10-08', end: '2026-10-08' })[0]).toMatch(/731 days.*at most 730/);
  });

  it('honours a different maxDays', () => {
    expect(problems({ lastDays: 91 }, { ...opts, maxDays: 90 })[0]).toMatch(/from 1 to 90/);
  });

  it('refuses start after end', () => {
    expect(problems({ start: '2026-02-01', end: '2026-01-01' })[0]).toMatch(/start 2026-02-01 is after end 2026-01-01/);
  });

  it('refuses start without end and end without start', () => {
    expect(problems({ start: '2026-02-01' })[0]).toMatch(/start and end go together/);
    expect(problems({ end: '2026-02-01' })[0]).toMatch(/start and end go together/);
  });

  it('refuses a window entirely after today', () => {
    expect(problems({ day: '2026-10-09' })).toEqual(['2026-10-09 is after today, 2026-10-08']);
    expect(problems({ start: '2026-11-01', end: '2026-11-30' })).toEqual(['2026-11-01 is after today, 2026-10-08']);
    expect(problems({ month: '2026-11' })[0]).toBe('2026-11-01 is after today, 2026-10-08');
  });

  it('clips an end after today and says so', () => {
    const w = win({ month: '2026-10' });
    expect(w).toMatchObject({ start: '2026-10-01', end: REF, asked: 'month 2026-10' });
    expect(w.clipped).toBe('The window asked for ended 2026-10-31; it was clipped to today, 2026-10-08.');
    expect(win({ start: '2026-10-01', end: REF }).clipped).toBeUndefined();
  });

  it('refuses two forms at once, naming them', () => {
    expect(problems({ day: '2026-03-05', lastDays: 7 })).toEqual(['Give only one of day, month, start+end or lastDays; got day and lastDays.']);
    expect(problems({ month: '2026-03', start: '2026-03-01', end: '2026-03-31' })[0]).toMatch(/got month and start\+end/);
  });

  it('refuses a bad lastDays and an unknown key', () => {
    expect(problems({ lastDays: 0 })[0]).toMatch(/lastDays must be a whole number from 1 to 730/);
    expect(problems({ lastDays: 7.5 })[0]).toMatch(/whole number/);
    expect(problems({ lastDays: 731 })[0]).toMatch(/from 1 to 730/);
    expect(problems({ week: '2026-W10' })[0]).toMatch(/week is not an accepted window field/);
    expect(problems('2026-03')[0]).toMatch(/window must be an object/);
  });
});

describe('WINDOW_SCHEMA', () => {
  it('is a closed object that the argument checker accepts for good input and refuses for bad', () => {
    expect(WINDOW_SCHEMA.type).toBe('object');
    expect(WINDOW_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(WINDOW_SCHEMA.properties ?? {})).toEqual(['day', 'month', 'start', 'end', 'lastDays']);
    expect(checkArgs(WINDOW_SCHEMA, { lastDays: 30 })).toEqual([]);
    expect(checkArgs(WINDOW_SCHEMA, { lastDays: 731 }).length).toBe(1);
    expect(checkArgs(WINDOW_SCHEMA, { hours: 3 }).length).toBe(1);
  });
});
