// ── The result envelope (design §6) ─────────────────────
import { describe, expect, it } from 'vitest';
import { invalidArgs, isErrorStatus, noDataInWindow, ok, pageRows, privacyBlocked, sourceUnavailable } from './envelope';

const cap = { id: 'workouts.sessions', title: 'Workout sessions' };
const window = { start: '2026-03-01', end: '2026-03-31', asked: 'month 2026-03' };

describe('constructors', () => {
  it('ok carries the data, window, coverage and page, and no next unless given', () => {
    const e = ok(cap, { n: 1 }, { window });
    expect(e).toEqual({ status: 'ok', capability: 'workouts.sessions', window, data: { n: 1 } });
    expect(ok(cap, [], { next: 'More.' }).next).toBe('More.');
  });

  it('noDataInWindow states what the app does hold', () => {
    const e = noDataInWindow(cap, window, { kind: 'known', first: '2026-01-02', last: '2026-10-08', count: 412, unit: 'sessions' });
    expect(e.status).toBe('no_data_in_window');
    expect(e.window).toEqual(window);
    expect(e.next).toBe('No Workout sessions between 2026-03-01 and 2026-03-31. The app holds 412 sessions from 2026-01-02 to 2026-10-08.');
  });

  it('noDataInWindow says "none at all" for a count of zero', () => {
    const e = noDataInWindow(cap, window, { kind: 'known', first: null, last: null, count: 0, unit: 'sessions' });
    expect(e.next).toBe('No Workout sessions between 2026-03-01 and 2026-03-31. The app holds none at all.');
  });

  it('noDataInWindow does not claim a count when coverage is unknown or unavailable', () => {
    const unknown = noDataInWindow(cap, window, { kind: 'unknown', reason: 'only the upstream can tell' });
    expect(unknown.next).toBe('No Workout sessions between 2026-03-01 and 2026-03-31. What else the app holds is unknown: only the upstream can tell.');
    const gone = noDataInWindow(cap, window, { kind: 'unavailable', reason: 'not configured' });
    expect(gone.next).toMatch(/could not be checked: not configured/);
  });

  it('sourceUnavailable scrubs the reason and never says "none"', () => {
    const e = sourceUnavailable(cap, 'GET https://user:pw@host.example/x failed, api_key=abcdef123456');
    expect(e.status).toBe('source_unavailable');
    expect(e.next).toMatch(/^Workout sessions could not be read: .* This says nothing about whether records exist\.$/);
    expect(e.next).not.toMatch(/pw@|abcdef123456/);
  });

  it('does not double the full stop when a reason already ends with one', () => {
    expect(sourceUnavailable(cap, 'Not configured.').next).toBe('Workout sessions could not be read: Not configured. This says nothing about whether records exist.');
    expect(noDataInWindow(cap, window, { kind: 'unavailable', reason: 'Not configured.' }).next).toMatch(/could not be checked: Not configured\.$/);
  });

  it('privacyBlocked names the setting', () => {
    expect(privacyBlocked(cap)).toEqual({
      status: 'privacy_blocked',
      capability: 'workouts.sessions',
      next: 'Workout sessions is withheld from the model by the AI privacy setting.',
    });
  });

  it('invalidArgs lists the problems and carries hints in data', () => {
    const e = invalidArgs(cap, ['window.day is not a real calendar day.'], { didYouMean: ['Running'] });
    expect(e.status).toBe('invalid_args');
    expect(e.problems).toEqual(['window.day is not a real calendar day.']);
    expect(e.data).toEqual({ didYouMean: ['Running'] });
    expect(e.next).toBe('Fix the arguments and call again. window.day is not a real calendar day. Did you mean: Running?');
    expect(invalidArgs(cap, ['x']).data).toBeUndefined();
  });
});

describe('isErrorStatus', () => {
  it('is false for ok and an empty window, true for the rest', () => {
    expect(isErrorStatus('ok')).toBe(false);
    expect(isErrorStatus('no_data_in_window')).toBe(false);
    expect(isErrorStatus('source_unavailable')).toBe(true);
    expect(isErrorStatus('privacy_blocked')).toBe(true);
    expect(isErrorStatus('invalid_args')).toBe(true);
  });
});

describe('pageRows', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, text: 'x'.repeat(20) }));
  const size = (r: unknown) => JSON.stringify(r).length;

  it('returns everything and no how-sentence when all rows fit', () => {
    const p = pageRows(rows, { limit: 25, offset: 0, maxChars: 10_000 });
    expect(p.rows).toHaveLength(10);
    expect(p.page).toEqual({ returned: 10, total: 10, offset: 0 });
  });

  it('stops at the limit and says how to continue', () => {
    const p = pageRows(rows, { limit: 4, offset: 0, maxChars: 10_000 });
    expect(p.rows.map(r => r.id)).toEqual([0, 1, 2, 3]);
    expect(p.page).toEqual({
      returned: 4,
      total: 10,
      offset: 0,
      nextOffset: 4,
      how: '4 of 10 shown. Call again with offset 4 for more, or use view: summary.',
    });
  });

  it('drops rows from the end when they overflow maxChars, never cutting inside one', () => {
    const one = size(rows[0]);
    const p = pageRows(rows, { limit: 10, offset: 0, maxChars: one * 3 + 4 });
    expect(p.rows).toHaveLength(3);
    expect(pageRows(rows, { limit: 10, offset: 0, maxChars: one * 3 + 3 }).rows).toHaveLength(2);
    expect(p.rows.every(r => r.text.length === 20)).toBe(true);
    expect(p.page.nextOffset).toBe(3);
    expect(p.page.how).toBe('3 of 10 shown. Call again with offset 3 for more, or use view: summary.');
    expect(JSON.stringify(p.rows).length).toBeLessThanOrEqual(one * 3 + 4);
  });

  it('pages from an offset', () => {
    const p = pageRows(rows, { limit: 4, offset: 8, maxChars: 10_000 });
    expect(p.rows.map(r => r.id)).toEqual([8, 9]);
    expect(p.page).toEqual({ returned: 2, total: 10, offset: 8 });
  });

  it('renders each row before measuring it', () => {
    const p = pageRows(rows, { limit: 10, offset: 0, maxChars: 40, render: r => r.id });
    expect(p.rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('still returns one row when a single row is larger than the budget, so paging cannot stall', () => {
    const p = pageRows(rows, { limit: 10, offset: 0, maxChars: 5 });
    expect(p.rows).toHaveLength(1);
    expect(p.page.nextOffset).toBe(1);
  });

  it('returns nothing past the end', () => {
    const p = pageRows(rows, { limit: 4, offset: 10, maxChars: 1000 });
    expect(p.rows).toEqual([]);
    expect(p.page).toEqual({ returned: 0, total: 10, offset: 10 });
  });
});
