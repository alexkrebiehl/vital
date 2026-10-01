import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveActivePlan, createPlan, describePlanDiff, PlanInputError, startFromReference, updateActivePlan } from './actions';
import { loadRoutine, undoPlanChange } from './service';
import { FilePlanRepository } from './store';
import { referencePlan } from './templates';

const ENV = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;
let dir: string;
let deps: { env: NodeJS.ProcessEnv; repo: FilePlanRepository };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-actions-'));
  deps = { env: ENV, repo: new FilePlanRepository(join(dir, 'plans.json')) };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const meta = { source: 'analyst' as const, summary: 'test' };

describe('plan actions', () => {
  it('starts from a reference, placing paths on the stages the demo sessions show', async () => {
    const { stored, change, inferred } = await startFromReference('calisthenics', meta, deps);
    expect(change).toMatchObject({ kind: 'create', fromRevision: null, toRevision: 1, previousActivePlanId: null });
    expect(inferred).toContain('Horizontal push: Decline push-up (since 2026-09-07)');
    // The start moves back to the first recognised session.
    expect(stored.plan.startDate).toBe('2026-06-19');

    const routine = await loadRoutine('metric', deps);
    expect(routine.state).toBe('ok');
    const push = routine.routine!.paths.find(p => p.pathId === 'horizontal-push')!;
    expect(push.stage.name).toBe('Decline push-up');
    expect(push.rows[push.rows.length - 1].work).toBe('Decline push-up 12/12/10');
  });

  it('refuses an invalid plan with actionable errors', async () => {
    await expect(createPlan({ title: 'x' }, { meta }, deps)).rejects.toBeInstanceOf(PlanInputError);
  });

  it('describes and undoes an update', async () => {
    await startFromReference('calisthenics', meta, deps);
    const { change } = await updateActivePlan(
      plan => {
        const path = plan.focusAreas[3].paths[0];
        path.hold = { kind: 'hold', reason: 'mild low-back discomfort', since: '2026-09-17' };
        return plan;
      },
      { source: 'analyst', summary: 'Paused core' },
      deps
    );
    expect(change.diff).toEqual(['Core: on hold (mild low-back discomfort)']);
    expect(change).toMatchObject({ kind: 'update', fromRevision: 1, toRevision: 2 });

    await undoPlanChange(change, deps);
    const active = await deps.repo.active();
    expect(active?.revision).toBe(3);
    expect(active?.plan.focusAreas[3].paths[0].hold).toBeUndefined();
    // Undoing the same change twice is refused: the plan moved on.
    await expect(undoPlanChange(change, deps)).rejects.toThrow(/cannot be undone/);
  });

  it('refuses a new phase target that sessions cannot check, naming the stages to use', async () => {
    await startFromReference('calisthenics', meta, deps);
    const addTarget = (target: Record<string, unknown>) =>
      updateActivePlan(
        plan => {
          plan.phases[3].targets.push(target as never);
          return plan;
        },
        meta,
        deps
      );

    const refused = await addTarget({ label: 'Archer push-up started', pathId: 'horizontal-push' }).catch(e => e);
    expect(refused).toBeInstanceOf(PlanInputError);
    expect(refused.errors[0]).toMatch(/target "Archer push-up started" cannot be checked/);
    expect(refused.errors[0]).toContain('archer-push-up');
    await expect(addTarget({ label: 'Stay consistent' })).rejects.toThrow(/give it a pathId/);

    const { stored } = await addTarget({ label: 'Archer push-up started', pathId: 'horizontal-push', stageId: 'archer-push-up', reach: 'started' });
    const routine = (await loadRoutine('metric', deps)).routine!;
    expect(routine.phases[3].targets.find(t => t.label === 'Archer push-up started')?.met).toBe(false);
    expect(stored.revision).toBe(2);
  });

  it('keeps a plan that already has an unchecked target editable', async () => {
    const { stored } = await startFromReference('calisthenics', meta, deps);
    const plan = structuredClone(stored.plan);
    plan.phases[3].targets.push({ label: 'Planche lean started', pathId: 'horizontal-push' });
    await deps.repo.update(stored.id, plan, stored.revision, meta);

    const { change } = await updateActivePlan(
      p => {
        p.focusAreas[3].paths[0].hold = { kind: 'hold', reason: 'sore', since: '2026-09-17' };
        return p;
      },
      meta,
      deps
    );
    expect(change.toRevision).toBe(3);
    await expect(createPlan(plan, { meta }, deps)).rejects.toThrow(/"Planche lean started" cannot be checked/);
  });

  it('undoing a new plan restores the one it replaced', async () => {
    const first = await startFromReference('calisthenics', meta, deps);
    const second = await startFromReference('strength', meta, deps);
    expect(second.change.previousActivePlanId).toBe(first.stored.id);
    await undoPlanChange(second.change, deps);
    expect((await deps.repo.active())?.id).toBe(first.stored.id);
  });

  it('archives and un-archives', async () => {
    await startFromReference('endurance-10k', meta, deps);
    const change = await archiveActivePlan(meta, deps);
    expect(await deps.repo.active()).toBeNull();
    expect((await loadRoutine('metric', deps)).state).toBe('no-plan');
    await undoPlanChange(change, deps);
    expect((await deps.repo.active())?.plan.title).toBe('12-week 10k build');
  });

  it('describes a new plan by its paths', () => {
    const v = referencePlan('strength', '2026-09-01');
    if (!v.ok) throw new Error();
    expect(describePlanDiff(null, v.plan)[0]).toBe('2 focus areas, 5 paths, 12 weeks from 2026-09-01');
  });
});
