// ── get_workouts: individual sessions and the roll-up ───────────────────────
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

describe('sessions: defaults', () => {
  it('lists the last 30 days, newest first, 20 to a page', async () => {
    const env = await sessions().read({}, testCtx());
    expect(env.status).toBe('ok');
    expect(env.window).toEqual({ start: addDays(REF, -29), end: REF, asked: 'lastDays 30 (default)' });
    const r = rows(env);
    expect(r).toHaveLength(20);
    expect(r.map(x => x.day)).toEqual([...r.map(x => x.day)].sort().reverse());
    const inWindow = workoutList().filter(w => workoutDayKey(w) >= addDays(REF, -29)).length;
    expect(env.page).toMatchObject({ returned: 20, total: inWindow, offset: 0, nextOffset: 20 });
    expect(env.page?.how).toMatch(/Call again with offset 20/);
    expectClean(env);
  });

  it('prints each field with the registry formatters, and leaves out what was not recorded', async () => {
    const env = await sessions().read({ window: WIDE, limit: 25 }, testCtx());
    const r = rows(env);
    const withAll = r.find(x => x.distance !== undefined && x.calories !== undefined && x.avgHeartRate !== undefined)!;
    expect(withAll.display.duration).toMatch(/^\d+:\d{2}$/);
    expect(withAll.display.distance).toMatch(/km$/);
    expect(withAll.display.calories).toMatch(/kcal/);
    expect(withAll.display.avgHeartRate).toMatch(/bpm/);
    const noCalories = (await sessions().read({ window: WIDE, limit: 25, sort: 'calories', order: 'asc' }, testCtx())) && r.find(x => x.calories === undefined);
    if (noCalories) expect(noCalories.display.calories).toBeUndefined();
    for (const x of r) if (x.distance === undefined) expect(x.display.distance).toBeUndefined();
  });

  it('prints distance in miles for an imperial reader', async () => {
    const env = await sessions().read({ window: WIDE, type: 'Running', limit: 5 }, testCtx({ system: 'imperial' }));
    expect(rows(env)[0].display.distance).toMatch(/mi$/);
  });
});

describe('sessions: windows', () => {
  it('takes a day, a month, a start and end, and lastDays', async () => {
    const day = await sessions().read({ window: { day: '2026-09-14' } }, testCtx());
    expect(rows(day).every(r => r.day === '2026-09-14')).toBe(true);
    expect(day.window?.asked).toBe('day 2026-09-14');
    const month = await sessions().read({ window: { month: '2026-03' }, limit: 25 }, testCtx());
    expect(month.window).toMatchObject({ start: '2026-03-01', end: '2026-03-31' });
    expect(rows(month).every(r => r.day.startsWith('2026-03'))).toBe(true);
    const range = await sessions().read({ window: { start: '2026-09-01', end: '2026-09-10' } }, testCtx());
    expect(rows(range).every(r => r.day >= '2026-09-01' && r.day <= '2026-09-10')).toBe(true);
  });

  it('keeps days as the alias of window.lastDays', async () => {
    const env = await sessions().read({ days: 7 }, testCtx());
    expect(env.window).toMatchObject({ start: addDays(REF, -6), end: REF, asked: 'lastDays 7' });
  });

  it('refuses days and window together, and a window after today', async () => {
    expect((await sessions().read({ days: 7, window: { lastDays: 3 } }, testCtx())).status).toBe('invalid_args');
    const future = await sessions().read({ window: { month: '2026-12' } }, testCtx());
    expect(future.status).toBe('invalid_args');
    expect(future.problems?.[0]).toMatch(/after today/);
  });

  it('is no_data_in_window before the data, carrying the coverage and the exact next', async () => {
    const env = await sessions().read({ window: { start: '2020-01-01', end: '2020-01-31' } }, testCtx());
    expect(env.status).toBe('no_data_in_window');
    expect(env.coverage).toEqual({ kind: 'known', first: addDays(REF, -399), last: REF, count: WORKOUT_COUNT, unit: 'sessions' });
    expect(env.next).toBe(`No Workout sessions between 2020-01-01 and 2020-01-31. The app holds ${WORKOUT_COUNT} sessions from ${addDays(REF, -399)} to ${REF}.`);
    expect(env.data).toBeUndefined();
  });
});

describe('sessions: arguments', () => {
  it.each([
    [{ view: 'table' }, /view must be one of: sessions, summary/],
    [{ sort: 'name' }, /sort must be one of: date, duration, calories, distance/],
    [{ order: 'up' }, /order must be one of: desc, asc/],
    [{ limit: 26 }, /limit must be a whole number from 1 to 25/],
    [{ limit: 0 }, /limit must be a whole number from 1 to 25/],
    [{ offset: -1 }, /offset must be a whole number/],
    [{ type: 5 }, /type must be text/],
    [{ detail: 'yes' }, /detail must be true or false/],
  ])('refuses %j with the problem', async (args, problem) => {
    const env = await sessions().read(args as Record<string, unknown>, testCtx());
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.join(' ')).toMatch(problem);
  });
});

describe('sessions: sorts', () => {
  const sorted = async (sort: string, order: string) => rows(await sessions().read({ window: WIDE, sort, order, limit: 25 }, testCtx()));

  it('sorts by date, either way', async () => {
    const asc = await sorted('date', 'asc');
    expect(asc.map(r => r.day)).toEqual([...asc.map(r => r.day)].sort());
  });

  it('sorts by duration, longest first by default order desc', async () => {
    const desc = await sorted('duration', 'desc');
    expect(desc.map(r => r.duration)).toEqual([...desc.map(r => r.duration)].sort((a, b) => b - a));
    expect(desc[0].duration).toBe(Math.max(...data.workouts.map(w => w.duration_minutes)));
    const asc = await sorted('duration', 'asc');
    expect(asc[0].duration).toBe(Math.min(...data.workouts.map(w => w.duration_minutes)));
  });

  it('sorts by calories and distance, and puts a session without the field last either way', async () => {
    for (const order of ['asc', 'desc']) {
      const cal = await sorted('calories', order);
      const values = cal.map(r => r.calories);
      const firstMissing = values.findIndex(v => v === undefined);
      if (firstMissing >= 0) expect(values.slice(firstMissing).every(v => v === undefined)).toBe(true);
      const dist = await sorted('distance', order);
      const dv = dist.map(r => r.distance);
      const missing = dv.findIndex(v => v === undefined);
      if (missing >= 0) expect(dv.slice(missing).every(v => v === undefined)).toBe(true);
    }
    const top = await sorted('distance', 'desc');
    expect(top[0].distance).toBe(Math.max(...data.workouts.map(w => w.distance_km ?? -1)));
  });
});

describe('sessions: paging over 420 workouts', () => {
  it('reaches the end by nextOffset with no session twice', async () => {
    const seen = new Set<string>();
    let offset = 0;
    let pages = 0;
    for (; pages < 40; pages++) {
      const env = await sessions().read({ window: WIDE, limit: 25, offset }, testCtx());
      expect(rows(env).length).toBeLessThanOrEqual(25);
      for (const r of rows(env)) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      if (env.page?.nextOffset === undefined) {
        expect(env.page?.total).toBe(WORKOUT_COUNT);
        break;
      }
      offset = env.page.nextOffset;
    }
    expect(seen.size).toBe(WORKOUT_COUNT);
  });

  it('keeps every page under 12,000 characters at the default and the maximum limit', async () => {
    expect(sizeOf(await sessions().read({ window: WIDE }, testCtx()))).toBeLessThanOrEqual(12_000);
    expect(sizeOf(await sessions().read({ window: WIDE, limit: 25 }, testCtx()))).toBeLessThanOrEqual(12_000);
  });
});

describe('sessions: type', () => {
  it('filters case-insensitively and lists the types in the window', async () => {
    const env = await sessions().read({ window: WIDE, type: 'running', limit: 25 }, testCtx());
    expect(rows(env).every(r => r.type === 'Running')).toBe(true);
    const types = (env.data as { typesInWindow: { type: string; sessions: number }[] }).typesInWindow;
    expect(types.map(t => t.type).sort()).toEqual([...WORKOUT_TYPES].sort());
    expect(types.reduce((n, t) => n + t.sessions, 0)).toBe(WORKOUT_COUNT);
    expect(env.page?.total).toBe(types.find(t => t.type === 'Running')!.sessions);
  });

  it('names the types that exist when the type is wrong', async () => {
    const env = await sessions().read({ window: WIDE, type: 'Rowing' }, testCtx());
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.[0]).toMatch(/No workouts of type "Rowing"/);
    expect((env.data as { typesInWindow: unknown[] }).typesInWindow).toHaveLength(WORKOUT_TYPES.length);
  });

  it('says a type that exists was not done in the window, with the types that were', async () => {
    const day = '2026-09-14';
    const present = new Set(data.workouts.filter(w => workoutDayKey(w) === day).map(w => w.workout_type));
    const absent = WORKOUT_TYPES.find(t => !present.has(t))!;
    const env = await sessions().read({ window: { day }, type: absent }, testCtx());
    expect(env.status).toBe('no_data_in_window');
    expect((env.data as { typesInWindow: { type: string }[] }).typesInWindow.map(t => t.type).sort()).toEqual([...present].sort());
  });
});
