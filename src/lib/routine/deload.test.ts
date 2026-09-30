import { describe, expect, it } from 'vitest';
import { detectDeloads, drops, easedKey } from './deload';
import type { PerformanceRecord } from './records';
import type { TrainingPlan } from './types';

function rec(date: string, reps: number[], rpe: number | null, id = date): PerformanceRecord {
  return {
    sessionId: id,
    date,
    startTime: `${date}T18:00:00.000Z`,
    exerciseName: 'Test',
    origin: 'workout-source',
    loadMeaning: 'added',
    sets: reps.map(r => ({ reps: r, ...(rpe !== null ? { rpe } : {}) })),
    totals: { reps: reps.reduce((a, b) => a + b, 0), tonnageKg: 0, distanceM: 0, durationS: 0, topWeightKg: null, topRpe: rpe, e1rmKg: null },
  };
}

const plan = (deloads: string[] = []) => ({ startDate: '2026-08-01', blocks: [], deloads }) as unknown as TrainingPlan;

// The two paths trained on the deload day, as logged: decline push-ups and assisted pull-ups.
const push = [rec('2026-09-18', [12, 12, 10], 9.5), rec('2026-09-22', [12, 12, 10], 9.5), rec('2026-09-25', [12, 12, 11], 9.5)];
const pull = [rec('2026-09-18', [5, 5, 4], 9.5), rec('2026-09-22', [5, 5, 5], 9.5), rec('2026-09-25', [6, 6, 5], 9.5)];
const byPath = (pushExtra: PerformanceRecord[], pullExtra: PerformanceRecord[]) =>
  new Map([
    ['push', new Map([['decline', [...push, ...pushExtra]]])],
    ['pull', new Map([['assisted', [...pull, ...pullExtra]]])],
  ]);

describe('deload detection', () => {
  it('reads a deload from fewer reps at a clearly lower effort on most paths trained', () => {
    const d = detectDeloads(plan(), byPath([rec('2026-09-29', [8, 8, 8], 7.5)], [rec('2026-09-29', [4, 4, 4], 7.5)]));
    expect(d.starts).toEqual(['2026-09-29']);
    expect(d.eased.get('push')?.has(easedKey('decline', '2026-09-29'))).toBe(true);
    expect(d.eased.get('pull')?.has(easedKey('assisted', '2026-09-29'))).toBe(true);
  });

  it('calls fewer reps at the same effort a bad day, not a deload', () => {
    const d = detectDeloads(plan(), byPath([rec('2026-09-29', [8, 8, 8], 9.5)], [rec('2026-09-29', [4, 4, 4], 9.5)]));
    expect(d.starts).toEqual([]);
    expect(d.eased.size).toBe(0);
  });

  it('needs an effort to tell an easy session from a bad one', () => {
    expect(drops(rec('2026-09-29', [8, 8, 8], null), push)).toEqual({ lighter: true, easier: false });
    const d = detectDeloads(plan(), byPath([rec('2026-09-29', [8, 8, 8], null)], [rec('2026-09-29', [4, 4, 4], null)]));
    expect(d.starts).toEqual([]);
  });

  it('pauses a lone easy session without starting a deload', () => {
    const d = detectDeloads(plan(), byPath([rec('2026-09-29', [8, 8, 8], 7.5)], [rec('2026-09-29', [6, 6, 5], 9.5)]));
    expect(d.starts).toEqual([]);
    expect(d.eased.get('push')?.has(easedKey('decline', '2026-09-29'))).toBe(true);
    expect(d.eased.has('pull')).toBe(false);
  });

  it('inside a recorded deload, lighter work is enough', () => {
    const d = detectDeloads(plan(['2026-09-29']), byPath([rec('2026-10-02', [8, 8, 8], 9.5)], []));
    expect(d.starts).toEqual([]);
    expect(d.eased.get('push')?.has(easedKey('decline', '2026-10-02'))).toBe(true);
  });

  it('a deload lasts a week; later sessions are judged against the ones before it', () => {
    const d = detectDeloads(
      plan(),
      byPath(
        [rec('2026-09-29', [8, 8, 8], 7.5), rec('2026-10-02', [8, 8, 8], 8), rec('2026-10-07', [10, 10, 10], 8.5)],
        [rec('2026-09-29', [4, 4, 4], 7.5), rec('2026-10-07', [6, 6, 6], 9)]
      )
    );
    expect(d.starts).toEqual(['2026-09-29']);
    const pushEased = d.eased.get('push')!;
    expect(pushEased.has(easedKey('decline', '2026-10-02'))).toBe(true);
    // 8 days after the start: outside the window, and not lighter than the pre-deload sessions' 33 reps.
    expect(pushEased.has(easedKey('decline', '2026-10-07'))).toBe(false);
  });
});
