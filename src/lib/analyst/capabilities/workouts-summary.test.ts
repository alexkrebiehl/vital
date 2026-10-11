// ── get_workouts: strength detail, the roll-up and coverage ───────────────────────
//
// 420 synthetic workouts of five types over 400 days ending 2026-10-08.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset, workoutList } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { workoutDayKey } from '../../analytics/workouts';
import { workoutsFor } from '../retrieval';
import { capabilityById } from './registry';
import { installTestDataset, REF, strengthSessions, trainingData, WORKOUT_COUNT, WORKOUT_TYPES } from './test-dataset.fake';
import { expectClean, sizeOf, testCtx } from './test-context.fake';
import type { HealthFixtures } from '../../metrics/types';
import type { PrivacyPolicy } from './types';

let data: HealthFixtures;
beforeEach(() => void (data = installTestDataset()));
afterEach(() => resetToDemoDataset());

type Row = { id: string; day: string; type: string; duration: number; distance?: number; calories?: number; avgHeartRate?: number; display: Record<string, string>; strength?: { title: string; exercises: { name: string; sets: string[] }[] } };
const sessions = () => capabilityById('workouts.sessions')!;
const summary = () => capabilityById('workouts.summary')!;
const rows = (env: { data?: unknown }) => (env.data as { sessions: Row[] }).sessions;
const WIDE = { lastDays: 400 };

describe('sessions: strength detail', () => {
  const strength = () => strengthSessions(data);

  it('joins the matching strength session, and leaves a workout without one alone', async () => {
    const ctx = testCtx({}, async () => trainingData(strength()));
    const env = await sessions().read({ window: WIDE, type: 'Strength Training', detail: true, limit: 6 }, ctx);
    const r = rows(env);
    const matched = r.filter(x => x.strength);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThan(r.length + 1);
    expect(matched[0].strength!.title).toMatch(/^Session \d+$/);
    expect(matched[0].strength!.exercises[0]).toEqual({ name: 'Back squat', sets: ['5 reps 80 kg RPE 8'] });
    expect(r.some(x => !x.strength)).toBe(true);
    expectClean(env);
  });

  it('attaches nothing, and reads nothing, without detail', async () => {
    let reads = 0;
    const ctx = testCtx({}, async () => (reads++, trainingData(strength())));
    const env = await sessions().read({ window: WIDE, type: 'Strength Training', limit: 6 }, ctx);
    expect(rows(env).some(x => x.strength)).toBe(false);
    expect(reads).toBe(0);
  });

  it('reads the strength sessions once per question', async () => {
    let reads = 0;
    const ctx = testCtx({}, async () => (reads++, trainingData(strength())));
    await sessions().read({ window: WIDE, type: 'Strength Training', detail: true, limit: 6 }, ctx);
    await sessions().read({ window: WIDE, type: 'Strength Training', detail: true, limit: 6, offset: 6 }, ctx);
    expect(reads).toBe(1);
  });

  it('survives a source that throws: no strength, a scrubbed note, not an error', async () => {
    const ctx = testCtx({}, async () => {
      throw new Error('boom https://user:hunter2secret@hevy.example.com/v1?api-key=abc123');
    });
    const env = await sessions().read({ window: WIDE, type: 'Strength Training', detail: true, limit: 3 }, ctx);
    expect(env.status).toBe('ok');
    expect(rows(env).some(x => x.strength)).toBe(false);
    const notes = (env.data as { notes: string[] }).notes;
    expect(notes[0]).toMatch(/Strength detail could not be read/);
    expect(JSON.stringify(env)).not.toMatch(/hunter2secret|abc123|hevy\.example/);
  });

  it('keeps a page of 25 detailed sessions under 12,000 characters', async () => {
    const ctx = testCtx({}, async () => trainingData(strength()));
    const env = await sessions().read({ window: WIDE, type: 'Strength Training', detail: true, limit: 25 }, ctx);
    expect(sizeOf(env)).toBeLessThanOrEqual(12_000);
  });
});

describe('summary', () => {
  it('rolls up totals, types, and the latest three sessions', async () => {
    const env = await summary().read({ window: { lastDays: 30 } }, testCtx());
    expect(env.status).toBe('ok');
    const d = env.data as { totals: { sessions: number; display: Record<string, string> }; byType: { type: string; sessions: number; display: { duration: string } }[]; typesInWindow: unknown[]; latest: Row[]; byMonth?: unknown };
    const inWindow = workoutList().filter(w => workoutDayKey(w) >= addDays(REF, -29));
    expect(d.totals.sessions).toBe(inWindow.length);
    expect(d.totals.display.duration).toMatch(/^\d+:\d{2}$/);
    expect(d.totals.display.sessionsPerWeek).toMatch(/^\d+\.\d$/);
    expect(d.byType.reduce((n, t) => n + t.sessions, 0)).toBe(inWindow.length);
    expect(d.latest).toHaveLength(3);
    expect(d.latest[0].day).toBe([...inWindow.map(workoutDayKey)].sort().reverse()[0]);
    expect(d.byMonth).toBeUndefined();
    expectClean(env);
  });

  it('breaks a window over 62 days down by month and type', async () => {
    const env = await summary().read({ window: WIDE }, testCtx());
    const d = env.data as { byMonth: { month: string; sessions: number; types: { type: string; sessions: number }[] }[] };
    expect(d.byMonth.length).toBeGreaterThanOrEqual(13);
    expect(d.byMonth.reduce((n, m) => n + m.sessions, 0)).toBe(WORKOUT_COUNT);
    expect(d.byMonth[0].types.length).toBeGreaterThan(0);
    expectClean(env);
    expect(sizeOf(env)).toBeLessThanOrEqual(12_000);
  });

  it('keeps the roll-up the old tool returned, with the same figures, under view: summary', async () => {
    const ctx = testCtx();
    const env = await summary().read({ days: 90 }, ctx);
    const old = workoutsFor(90, REF).workouts;
    const rollup = (env.data as { rollup: { sessions: number; minutes: number; calories: number | null; calorieSessions: number; byType: unknown[]; recent: number; prior: number; display: Record<string, string> } }).rollup;
    expect(rollup).toMatchObject({ sessions: old.sessions, minutes: old.minutes, calories: old.calories, calorieSessions: old.calorieSessions, recent: old.recent, prior: old.prior });
    expect(rollup.byType).toHaveLength(old.byType.length);
    expect(ctx.access.fetched.workouts?.sessions).toBe(old.sessions);
    expectClean(env);
  });

  it('has no roll-up for a window that ended before today, but still the totals', async () => {
    const env = await summary().read({ window: { month: '2026-03' } }, testCtx());
    expect((env.data as { rollup?: unknown }).rollup).toBeUndefined();
    expect((env.data as { totals: { sessions: number } }).totals.sessions).toBeGreaterThan(20);
  });

  it('filters by type and still lists every type in the window', async () => {
    const env = await summary().read({ window: WIDE, type: 'yoga' }, testCtx());
    const d = env.data as { totals: { sessions: number }; typesInWindow: { type: string }[] };
    expect(d.totals.sessions).toBe(data.workouts.filter(w => w.workout_type === 'Yoga').length);
    expect(d.typesInWindow).toHaveLength(WORKOUT_TYPES.length);
  });

  it('is no_data_in_window for an empty window, and a privacy block before any read', async () => {
    expect((await summary().read({ window: { start: '2020-01-01', end: '2020-01-31' } }, testCtx())).status).toBe('no_data_in_window');
    const policy: PrivacyPolicy = { allows: () => false };
    const ctx = testCtx({ policy });
    expect((await summary().read({}, ctx)).status).toBe('privacy_blocked');
    expect((await sessions().read({}, ctx)).status).toBe('privacy_blocked');
    expect(ctx.access.fetched.workouts).toBeNull();
  });
});

describe('coverage', () => {
  it('is the span and count of the installed workouts', async () => {
    expect(await sessions().coverage(testCtx())).toEqual({ kind: 'known', first: addDays(REF, -399), last: REF, count: WORKOUT_COUNT, unit: 'sessions' });
  });
});
