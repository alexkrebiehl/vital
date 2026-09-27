import { describe, expect, it } from 'vitest';
import { cadenceView, type CadenceDay } from './cadence';
import { planWeek } from './position';
import { nextSession, type CompletedSession } from './schedule';
import { validatePlan } from './validate';
import type { TrainingPlan } from './types';

// Wednesday; the week runs Mon Sep 28 – Sun Oct 4.
const TODAY = '2026-09-30';

function plan(schedule: unknown, blocks: unknown[] = []): TrainingPlan {
  const v = validatePlan({
    title: 'Plan',
    goal: 'Test',
    startDate: '2026-09-01',
    durationWeeks: 12,
    focusAreas: [
      {
        name: 'All',
        paths: [
          { id: 'push', name: 'Push', stages: [{ name: 'Push-up', match: { names: ['Push-up'] } }] },
          { id: 'pull', name: 'Pull', stages: [{ name: 'Row', match: { names: ['Row'] } }] },
        ],
      },
    ],
    templates: [
      { id: 'a', name: 'Workout A', slots: [{ pathIds: ['push'] }] },
      { id: 'b', name: 'Workout B', slots: [{ pathIds: ['pull'] }] },
    ],
    schedule,
    blocks,
  });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.plan;
}

const done = (...entries: [string, string][]): CompletedSession[] =>
  entries.map(([date, templateId]) => ({ date, templateId, sessionId: `${templateId}:${date}` }));

function view(p: TrainingPlan, completed: CompletedSession[], today = TODAY) {
  const week = planWeek(p, today);
  return cadenceView(p, completed, nextSession(p, completed, today, week, 'metric'), today, week);
}

/** Each day of the strip as "Wed: A" (expected), "Mon: ✓A" (logged), "Mon: -" (past, nothing). */
function strip(days: CadenceDay[]): string[] {
  return days.map(d => {
    const logged = d.logged.map(t => `✓${t.name.slice(-1)}`).join('+');
    const expected = !d.expected
      ? ''
      : d.expected.kind === 'train'
        ? d.expected.templates.map(t => t.name.slice(-1)).join('+')
        : d.expected.kind;
    return `${d.weekday}: ${[logged, expected].filter(Boolean).join(' ') || '-'}`;
  });
}

const ABR = { kind: 'cycle', advance: 'on-completion', days: [{ templateIds: ['a'] }, { templateIds: ['b'] }, { rest: true }] };

describe('cadenceView — cycle, moving on when a session is logged', () => {
  it('starts at the top of the cycle with nothing logged', () => {
    const c = view(plan(ABR), []);
    expect(c.caption).toBe('3-day cycle · moves on when you log a session');
    expect(c.pattern.map(n => n.current)).toEqual(['today', null, null]);
    expect(strip(c.week)).toEqual(['Mon: -', 'Tue: -', 'Wed: A', 'Thu: B', 'Fri: rest', 'Sat: A', 'Sun: B']);
    expect(c.weekSummary).toBe('No sessions logged yet this week');
  });

  it('shows the logged days and walks the cycle from where the reader is', () => {
    const c = view(plan(ABR), done(['2026-09-28', 'a'], ['2026-09-29', 'b']));
    expect(c.pattern.map(n => n.current)).toEqual([null, null, 'today']);
    expect(strip(c.week)).toEqual(['Mon: ✓A', 'Tue: ✓B', 'Wed: rest', 'Thu: A', 'Fri: B', 'Sat: rest', 'Sun: A']);
    expect(c.weekSummary).toBe('2 sessions logged this week');
  });

  it('counts a rest day as taken once a calendar day has passed', () => {
    const c = view(plan(ABR), done(['2026-09-26', 'a'], ['2026-09-27', 'b']));
    expect(c.pattern.map(n => n.current)).toEqual(['today', null, null]);
    expect(strip(c.week).slice(2, 5)).toEqual(['Wed: A', 'Thu: B', 'Fri: rest']);
  });

  it('marks the next day once today is logged, and expects nothing more of today', () => {
    const c = view(plan(ABR), done(['2026-09-30', 'a']));
    expect(c.pattern.map(n => n.current)).toEqual([null, 'next', null]);
    expect(strip(c.week).slice(2, 5)).toEqual(['Wed: ✓A', 'Thu: B', 'Fri: rest']);
  });
});

describe('cadenceView — other schedule shapes', () => {
  it('follows the calendar from the anchor', () => {
    const c = view(plan({ ...ABR, advance: 'calendar', anchorDate: '2026-09-01' }), []);
    expect(c.caption).toBe('3-day cycle · follows the calendar from Sep 1');
    // Sep 30 is 29 days after the anchor: day 3 of the cycle.
    expect(c.pattern.map(n => n.current)).toEqual([null, null, 'today']);
    expect(strip(c.week).slice(2)).toEqual(['Wed: rest', 'Thu: A', 'Fri: B', 'Sat: rest', 'Sun: A']);
  });

  it('uses the weekly map for a weekday schedule, with no separate pattern', () => {
    const c = view(plan({ kind: 'weekdays', days: { mon: { templateIds: ['a'] }, wed: { templateIds: ['b'] }, fri: { templateIds: ['a'] } } }), done(['2026-09-28', 'a']));
    expect(c.caption).toBe('Weekly: Mon, Wed, Fri');
    expect(c.pattern).toEqual([]);
    expect(strip(c.week)).toEqual(['Mon: ✓A', 'Tue: -', 'Wed: B', 'Thu: rest', 'Fri: A', 'Sat: rest', 'Sun: rest']);
  });

  it('leaves the days open for a frequency plan and counts against the range', () => {
    const c = view(
      plan({ kind: 'frequency', sessionsPerWeek: [3, 4], rotation: ['a', 'b'], minRestHours: 48 }),
      done(['2026-09-28', 'a'], ['2026-09-29', 'b'])
    );
    expect(c.caption).toBe('3–4 sessions a week, rotating · at least 48 h between');
    expect(c.weekSummary).toBe('2 of 3–4 this week');
    // Rest is due (48 h have not passed), so A is next rather than today.
    expect(c.pattern.map(n => [n.templates[0].name, n.current])).toEqual([['Workout A', 'next'], ['Workout B', null]]);
    expect(strip(c.week).slice(2)).toEqual(['Wed: open', 'Thu: open', 'Fri: open', 'Sat: open', 'Sun: open']);
  });

  it("names a block's schedule while it overrides the plan's", () => {
    const c = view(
      plan(ABR, [
        { id: 'deload', name: 'Deload', startWeek: 5, weeks: 1, goals: [], targets: [], scheduleOverride: { kind: 'cycle', advance: 'on-completion', days: [{ templateIds: ['a'] }, { rest: true }] } },
      ]),
      []
    );
    expect(c.caption).toBe('2-day cycle · moves on when you log a session (Deload schedule)');
    expect(c.pattern).toHaveLength(2);
  });
});
