import { describe, expect, it } from 'vitest';
import { MATCH_MIN_OVERLAP, MATCH_SLACK_MS, intervalsMatch, matchSession } from './match';

const T0 = Date.parse('2026-09-10T15:00:00.000Z');
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const span = (from: number, to: number) => ({ start: iso(from), end: iso(to) });

describe('intervalsMatch', () => {
  it('matches an 80% overlap', () => {
    // 30-minute sessions, shifted 6 minutes: 24 of 30 minutes overlap.
    expect(intervalsMatch(span(0, 30), span(6, 36), { slackMs: 0 })).toBe(true);
  });

  it('does not match two sessions that only touch', () => {
    expect(intervalsMatch(span(0, 30), span(30, 60), { slackMs: 0 })).toBe(false);
  });

  it('does not match back-to-back sessions with a 1-minute gap, even with the default slack', () => {
    expect(intervalsMatch(span(0, 30), span(31, 61))).toBe(false);
  });

  it('uses the stated defaults', () => {
    expect(MATCH_MIN_OVERLAP).toBe(0.5);
    expect(MATCH_SLACK_MS).toBe(5 * 60_000);
  });

  it('is false for an interval it cannot read', () => {
    expect(intervalsMatch({ start: 'x', end: iso(10) }, span(0, 10))).toBe(false);
  });
});

describe('matchSession', () => {
  const session = (from: number, to: number) => ({ startTime: iso(from), endTime: iso(to) });

  it('still returns the best-overlapping session', () => {
    const near = session(1, 29);
    const far = session(100, 130);
    expect(matchSession({ start_time: iso(0), end_time: iso(30) }, [far, near])).toBe(near);
  });

  it('returns null when nothing overlaps enough', () => {
    expect(matchSession({ start_time: iso(0), end_time: iso(30) }, [session(100, 130)])).toBeNull();
  });
});
