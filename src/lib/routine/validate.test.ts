import { describe, expect, it } from 'vitest';
import { REFERENCE_PLANS, referencePlan } from './templates';
import { currentStage, findPath, nextStage, slugify, validatePlan } from './validate';

function minimal(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Plan',
    goal: 'Get stronger',
    startDate: '2026-07-01',
    durationWeeks: 8,
    focusAreas: [
      {
        name: 'Upper',
        paths: [
          {
            name: 'Push',
            stages: [
              { name: 'Floor push-up', prescription: { sets: [3, 4], reps: [8, 12] } },
              { name: 'Decline push-up' },
            ],
          },
        ],
      },
    ],
    templates: [{ name: 'Full body', slots: [{ pathIds: ['push'] }] }],
    schedule: { kind: 'cycle', days: ['full-body', 'rest'] },
    ...overrides,
  };
}

function errorsOf(input: unknown): string[] {
  const v = validatePlan(input);
  return v.ok ? [] : v.errors;
}

describe('validatePlan', () => {
  it('fills ids, defaults and the current stage from a sparse plan', () => {
    const v = validatePlan(minimal());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const path = v.plan.focusAreas[0].paths[0];
    expect(v.plan.focusAreas[0].id).toBe('upper');
    expect(path).toMatchObject({ id: 'push', model: 'variation', priority: 'primary', currentStageId: 'floor-push-up', history: [] });
    expect(path.stages[1].id).toBe('decline-push-up');
    // A stage with no match falls back to its own name.
    expect(path.stages[1].match.names).toEqual(['Decline push-up']);
    expect(v.plan.rules.qualifyingSessions).toEqual([2, 3]);
    expect(v.plan.templates[0].id).toBe('full-body');
    expect(v.plan.blocks).toEqual([]);
  });

  it('reads a single number as a one-value range', () => {
    const v = validatePlan(minimal({ focusAreas: [{ name: 'A', paths: [{ name: 'P', stages: [{ name: 'S', prescription: { sets: 3, reps: [5, 5] } }] }] }], templates: [{ name: 'T', slots: [{ pathIds: ['p'] }] }], schedule: { kind: 'frequency', sessionsPerWeek: 3, rotation: ['t'] } }));
    expect(v.ok && v.plan.focusAreas[0].paths[0].stages[0].prescription?.sets).toEqual([3, 3]);
  });

  it('names the exact field and the accepted values in every error', () => {
    const errors = errorsOf(
      minimal({
        durationWeeks: 500,
        schedule: { kind: 'cycle', days: ['nope', 'rest'] },
        templates: [{ name: 'Full body', slots: [{ pathIds: ['pull'] }] }],
      })
    );
    expect(errors.some(e => e.startsWith('plan.durationWeeks') && e.includes('1 to 104'))).toBe(true);
    expect(errors.some(e => e.includes('plan.templates[0].slots[0].pathIds') && e.includes('"pull" is not a path id'))).toBe(true);
    expect(errors.some(e => e.includes('plan.schedule.days[0]') && e.includes('"nope"'))).toBe(true);
  });

  it('rejects inverted ranges, unknown dose fields and out-of-range RPE', () => {
    const errors = errorsOf(
      minimal({
        focusAreas: [{ name: 'A', paths: [{ name: 'P', stages: [{ name: 'S', prescription: { reps: [12, 8], effort: { rpe: [7, 11] }, tempo: '3-1-1' } }] }] }],
        templates: [{ name: 'T', slots: [{ pathIds: ['p'] }] }],
        schedule: { kind: 'cycle', days: ['t'] },
      })
    );
    expect(errors.some(e => e.includes('prescription.reps'))).toBe(true);
    expect(errors.some(e => e.includes('effort.rpe'))).toBe(true);
    expect(errors.some(e => e.includes('prescription.tempo') && e.includes('not a dose field'))).toBe(true);
  });

  it('rejects duplicate explicit ids and a current stage that does not exist', () => {
    const errors = errorsOf(
      minimal({
        focusAreas: [
          { name: 'A', paths: [
            { id: 'p', name: 'P', currentStageId: 'missing', stages: [{ name: 'S' }] },
            { id: 'p', name: 'Q', stages: [{ name: 'S' }] },
          ] },
        ],
        templates: [{ name: 'T', slots: [{ pathIds: ['p'] }] }],
        schedule: { kind: 'cycle', days: ['t'] },
      })
    );
    expect(errors.some(e => e.includes('"p" is used twice'))).toBe(true);
    expect(errors.some(e => e.includes('currentStageId') && e.includes('"missing"'))).toBe(true);
  });

  it('checks model params against the model', () => {
    const plan = minimal();
    (plan.focusAreas[0].paths[0] as Record<string, unknown>).model = 'load';
    (plan.focusAreas[0].paths[0] as Record<string, unknown>).params = { incrementKg: 0, bogus: 1 };
    const errors = errorsOf(plan);
    expect(errors.some(e => e.includes('params.incrementKg'))).toBe(true);
    expect(errors.some(e => e.includes('params.bogus') && e.includes('incrementKg'))).toBe(true);
  });

  it('accepts every schedule shape: cycles of any length, weekdays and frequency', () => {
    const ok = (schedule: unknown) => validatePlan(minimal({ schedule })).ok;
    expect(ok({ kind: 'cycle', days: ['full-body'] })).toBe(true); // every day
    expect(ok({ kind: 'cycle', days: ['full-body', 'rest'] })).toBe(true); // on/off
    expect(ok({ kind: 'cycle', days: ['full-body', 'full-body', 'rest'], advance: 'calendar', anchorDate: '2026-07-01' })).toBe(true);
    expect(ok({ kind: 'weekdays', days: { mon: 'full-body', thu: { templateIds: ['full-body'] }, sun: 'rest' } })).toBe(true);
    expect(ok({ kind: 'frequency', sessionsPerWeek: [3, 4], rotation: ['full-body'] })).toBe(true);
    expect(ok({ kind: 'cycle', days: ['rest'] })).toBe(false);
    expect(ok({ kind: 'weekdays', days: { funday: 'full-body' } })).toBe(false);
    expect(ok({ kind: 'sometimes' })).toBe(false);
  });

  it('keeps blocks inside the plan and their targets on real paths', () => {
    const errors = errorsOf(minimal({ blocks: [{ name: 'Late', startWeek: 7, weeks: 4, targets: [{ label: 'x', pathId: 'nope' }] }] }));
    expect(errors.some(e => e.includes('past the plan'))).toBe(true);
    expect(errors.some(e => e.includes('"nope" is not a path id'))).toBe(true);
  });

  it('keeps path ids clear of the routine\'s own routes', () => {
    const withPath = (path: Record<string, unknown>) =>
      minimal({
        focusAreas: [{ name: 'Upper', paths: [{ stages: [{ name: 'Floor push-up' }], ...path }] }],
        templates: [{ id: 'full', name: 'Full body', slots: [{ pathIds: ['workouts-path'] }] }],
        schedule: { kind: 'cycle', days: ['full', 'rest'] },
      });
    expect(errorsOf(withPath({ id: 'workouts', name: 'Push' })).join('\n')).toMatch(/focusAreas\[0\]\.paths\[0\]\.id.*"workouts" is reserved.*"workouts-path"/);
    expect(errorsOf(withPath({ id: 'Undo', name: 'Push' })).join('\n')).toMatch(/"undo" is reserved/);
    // A name that slugs to a reserved id gets a safe one instead of an error.
    const v = validatePlan(withPath({ name: 'Workouts' }));
    expect(v.ok && v.plan.focusAreas[0].paths[0].id).toBe('workouts-path');
  });

  it('requires the essentials', () => {
    const errors = errorsOf({});
    for (const field of ['plan.title', 'plan.goal', 'plan.startDate', 'plan.durationWeeks', 'plan.focusAreas', 'plan.templates', 'plan.schedule']) {
      expect(errors.some(e => e.startsWith(field))).toBe(true);
    }
  });
});

describe('reference plans', () => {
  it.each(REFERENCE_PLANS.map(r => r.id))('%s is a valid plan', id => {
    const v = referencePlan(id, '2026-06-19');
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  it('span different models and schedule kinds', () => {
    const plans = REFERENCE_PLANS.map(r => referencePlan(r.id, '2026-06-19')).flatMap(v => (v.ok ? [v.plan] : []));
    const models = new Set(plans.flatMap(p => p.focusAreas.flatMap(a => a.paths.map(x => x.model))));
    const kinds = new Set(plans.map(p => p.schedule.kind));
    expect(models).toEqual(new Set(['variation', 'load', 'volume', 'maintain']));
    expect(kinds).toEqual(new Set(['cycle', 'weekdays', 'frequency']));
  });
});

describe('lookups', () => {
  it('finds a path and its current and next stage', () => {
    const v = referencePlan('calisthenics', '2026-06-19');
    if (!v.ok) throw new Error(v.errors.join(' '));
    const hit = findPath(v.plan, 'horizontal-push')!;
    expect(hit.area.name).toBe('Push');
    expect(currentStage(hit.path).id).toBe('incline-push-up');
    expect(nextStage(hit.path)?.id).toBe('floor-push-up');
    expect(slugify('Workout A: Upper body!')).toBe('workout-a-upper-body');
  });
});
