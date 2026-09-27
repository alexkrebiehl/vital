import { afterEach, describe, expect, it } from 'vitest';
import type { TrainingSession } from '../workout-sources/types';
import { awaitNarrativesIdle, checkNarrative, factSheet, narrativeFor, resetNarrativeCacheForTests } from './narrative';
import { buildRoutine } from './progress';
import { validatePlan } from './validate';

afterEach(() => resetNarrativeCacheForTests());

const s = (date: string, reps: number[], rpe: number[]): TrainingSession => ({
  id: `s:${date}`, sourceId: 't', title: 'x', startTime: `${date}T18:00:00Z`, endTime: `${date}T18:30:00Z`,
  exercises: [{ sourceTemplateId: null, name: 'Decline Push Up', loadMeaning: 'none', sets: reps.map((r, i) => ({ index: i, kind: 'normal', reps: r, rpe: rpe[i] })) }],
});

function routine() {
  const v = validatePlan({
    title: 'P', goal: 'G', startDate: '2026-09-01', durationWeeks: 8,
    focusAreas: [{ name: 'Push', paths: [{ id: 'push', name: 'Horizontal push', stages: [
      { id: 'decline', name: 'Decline push-up', match: { names: ['Decline Push Up'] }, advanceWhen: { sets: [3, 4], reps: [8, 12], effort: { rpe: [7, 9] } } },
    ] }] }],
    templates: [{ id: 'a', name: 'A', slots: [{ pathIds: ['push'] }] }],
    schedule: { kind: 'cycle', days: ['a', 'rest'] },
  });
  if (!v.ok) throw new Error(v.errors.join());
  const r = buildRoutine({
    stored: { id: 'p', status: 'active', plan: v.plan, revision: 1, createdAt: '', updatedAt: '' },
    sessions: [s('2026-09-08', [8, 8, 8], [7.5, 8, 8.5]), s('2026-09-18', [12, 12, 10], [8.5, 9, 9.5])],
    workouts: [], series: () => [], today: '2026-09-18', dayOf: d => d.slice(0, 10), system: 'metric',
  });
  return { r, p: r.paths[0] };
}

const GOOD = JSON.stringify({
  assessment: 'Decline push-ups reached 12/12/10 on 2026-09-18, near the top of the 8–12 range, but effort hit RPE 9.5, so the light is yellow-green.',
  nextAction: 'Repeat 3×10–12 with lower effort for 2–3 sessions before moving on.',
});

describe('path narrative', () => {
  it('serves computed text at once, then the checked model note', async () => {
    const { r, p } = routine();
    const complete = async () => ({ text: GOOD, model: 'mock-1' });
    const first = narrativeFor(r, p, '2026-09-18', 'metric', { complete });
    expect(first).toMatchObject({ source: 'computed', pending: true, nextAction: p.nextAction });
    await awaitNarrativesIdle();
    const second = narrativeFor(r, p, '2026-09-18', 'metric', { complete });
    expect(second).toMatchObject({ source: 'model', model: 'mock-1', pending: false });
    expect(second.assessment).toContain('12/12/10');
  });

  it('rejects a note with an invented figure or the wrong light, and says why', async () => {
    const { r, p } = routine();
    const facts = factSheet(r, p);
    expect(checkNarrative({ assessment: 'You did 40 reps.', nextAction: 'Rest.' }, facts, p.light)).toMatch(/not in the computed data \(40\)/);
    expect(checkNarrative({ assessment: 'The light is green.', nextAction: 'Move on.' }, facts, p.light)).toMatch(/as green/);
    expect(checkNarrative(JSON.parse(GOOD), facts, p.light)).toBeNull();

    const complete = async () => ({ text: JSON.stringify({ assessment: 'Green light: 50 reps!', nextAction: 'Progress.' }), model: 'm' });
    narrativeFor(r, p, '2026-09-18', 'metric', { complete });
    await awaitNarrativesIdle();
    const view = narrativeFor(r, p, '2026-09-18', 'metric', { complete });
    expect(view.source).toBe('computed');
    expect(view.note).toMatch(/was not used because it stated figures/);
  });

  it('explains when no model is configured', async () => {
    const { r, p } = routine();
    narrativeFor(r, p, '2026-09-18', 'metric', { env: {} as NodeJS.ProcessEnv });
    await awaitNarrativesIdle();
    expect(narrativeFor(r, p, '2026-09-18', 'metric', { env: {} as NodeJS.ProcessEnv }).note).toMatch(/No AI model is configured/);
  });
});
