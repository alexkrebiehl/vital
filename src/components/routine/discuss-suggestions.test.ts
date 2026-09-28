import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFromReference } from '@/lib/routine/actions';
import { loadRoutine } from '@/lib/routine/service';
import { FilePlanRepository } from '@/lib/routine/store';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import { pathSuggestions, routineSuggestions, untrackedSuggestions, workoutSuggestions } from './discuss-suggestions';

// The demo analyst's plan-status pattern (demo-plan.ts): every set has a
// question it can route, so the dialog works without a configured provider.
const DEMO_ROUTABLE = /\b(routine|plan|program|progress|progression)\b/;

let dir: string;
let routine: RoutineOverview;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vital-suggestions-'));
  const deps = { env: { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv, repo: new FilePlanRepository(join(dir, 'plans.json')) };
  await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, deps);
  routine = (await loadRoutine('metric', deps)).routine!;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const path = (over: Partial<PathProgress> = {}): PathProgress => ({ ...routine.paths[0], hold: null, ...over }) as PathProgress;

describe('discuss suggestions', () => {
  it('include a question the demo analyst can route in every set', () => {
    const sets = [
      routineSuggestions(routine),
      pathSuggestions(path()),
      workoutSuggestions(routine.workouts[0]),
      untrackedSuggestions({ name: 'Dips', sessions: 3, lastDate: '2026-09-20' }),
    ];
    for (const set of sets) {
      expect(set.length).toBeGreaterThanOrEqual(2);
      expect(set.length).toBeLessThanOrEqual(4);
      expect(set.some(q => DEMO_ROUTABLE.test(q.toLowerCase()))).toBe(true);
      for (const q of set) expect(q.length).toBeLessThanOrEqual(400);
    }
  });

  it('ask about a deload, recovery and untracked exercises only when the plan shows them', () => {
    const calm = routineSuggestions({
      ...routine,
      deload: { ...routine.deload, status: 'ok' },
      recovery: { ...routine.recovery, status: 'ok' },
      untracked: [],
    });
    expect(calm.join(' ')).not.toMatch(/deload|recovery|go in my plan/);
    const busy = routineSuggestions({
      ...routine,
      deload: { ...routine.deload, status: 'due' },
      recovery: { ...routine.recovery, status: 'warn' },
      untracked: [{ name: 'Dips', templateId: null, sessions: 2, lastDate: '2026-09-20' } as RoutineOverview['untracked'][number]],
    });
    expect(busy).toContain('Should I start a deload this week?');
    expect(busy.join(' ')).toMatch(/recovery/);
  });

  it('ask about the next stage when a path is ready, and about the hold when it is held', () => {
    const next = routine.paths.find(p => p.nextStage)!;
    const ready = pathSuggestions({ ...next, hold: null, light: 'green' } as PathProgress);
    expect(ready).toContain(`Am I ready to move to ${next.nextStage!.name}?`);
    expect(ready).toContain('Why is this path green?');

    const held = pathSuggestions(path({ hold: { kind: 'hold', reason: 'elbow', since: '2026-09-01' }, light: 'yellow' }));
    expect(held.join(' ')).toMatch(/clear the hold/);
    expect(held.join(' ')).not.toMatch(/ready to move/);

    expect(pathSuggestions(path({ light: 'none' }))).toContain('Why does this path have no light yet?');
  });
});
