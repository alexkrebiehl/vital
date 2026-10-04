import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanSqlClient } from '@/lib/db/plan-store';
import { runAsUser } from '@/lib/identity/scope';
import { referencePlan } from './templates';
import {
  FilePlanRepository,
  PlanConflictError,
  PostgresPlanRepository,
  revertPlan,
  type PlanRepository,
} from './store';
import type { TrainingPlan } from './types';

function plan(id = 'calisthenics'): TrainingPlan {
  const v = referencePlan(id, '2026-06-19');
  if (!v.ok) throw new Error(v.errors.join(' '));
  return v.plan;
}

/**
 * An in-memory stand-in for the handful of statements plan-store.ts runs, so
 * the Postgres repository is exercised without a database.
 */
class FakePlanDb implements PlanSqlClient {
  plans: Record<string, unknown>[] = [];
  revisions: Record<string, unknown>[] = [];
  statements: string[] = [];
  private clock = Date.parse('2026-09-18T12:00:00Z');

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    // Every per-person statement names its user as the LAST parameter.
    const user = params[params.length - 1];
    const mine = () => this.plans.filter(p => p.user_id === user);
    const owns = (planId: unknown) => this.plans.some(p => p.id === planId && p.user_id === user);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.startsWith("SELECT id, status, plan, revision, created_at, updated_at FROM training_plans WHERE status = 'active' AND user_id = $1")) {
      return { rows: mine().filter(p => p.status === 'active') };
    }
    if (sql.startsWith('SELECT id, status, plan, revision, created_at, updated_at FROM training_plans WHERE id = $1 AND user_id = $2')) {
      return { rows: mine().filter(p => p.id === params[0]) };
    }
    if (sql.startsWith('SELECT id, status, plan, revision, created_at, updated_at FROM training_plans WHERE user_id = $2 ORDER BY')) {
      return { rows: [...mine()].reverse() };
    }
    if (sql.startsWith('SELECT revision FROM training_plans WHERE id = $1 AND user_id = $2') || sql.startsWith('SELECT 1 FROM training_plans WHERE id = $1 AND user_id = $2')) {
      return { rows: mine().filter(p => p.id === params[0]) };
    }
    if (sql.startsWith("UPDATE training_plans SET status = 'archived', updated_at = now() WHERE status = 'active'")) {
      const except = sql.includes('id <> $1') ? params[0] : undefined;
      for (const p of mine()) if (p.status === 'active' && p.id !== except) p.status = 'archived';
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO training_plans')) {
      const at = this.tick();
      const row = { id: params[0], status: 'active', plan: JSON.parse(params[1] as string), revision: 1, created_at: at, updated_at: at, user_id: user };
      if (mine().some(p => p.status === 'active')) throw new Error('unique violation: training_plans_one_active');
      this.plans.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE training_plans SET plan = $2')) {
      const row = mine().find(p => p.id === params[0] && p.revision === params[3]);
      if (!row) return { rows: [] };
      Object.assign(row, { plan: JSON.parse(params[1] as string), revision: (row.revision as number) + 1, updated_at: this.tick() });
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE training_plans SET status = $2')) {
      const row = mine().find(p => p.id === params[0]);
      if (!row) return { rows: [] };
      Object.assign(row, { status: params[1], updated_at: this.tick() });
      return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO training_plan_revisions')) {
      this.revisions.push({ plan_id: params[0], revision: params[1], source: params[2], summary: params[3], plan: JSON.parse(params[4] as string), created_at: this.tick() });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT plan_id, revision, source, summary, created_at FROM training_plan_revisions')) {
      if (!owns(params[0])) return { rows: [] };
      return { rows: this.revisions.filter(r => r.plan_id === params[0]).sort((a, b) => (b.revision as number) - (a.revision as number)) };
    }
    if (sql.startsWith('SELECT plan FROM training_plan_revisions')) {
      if (!owns(params[0])) return { rows: [] };
      return { rows: this.revisions.filter(r => r.plan_id === params[0] && r.revision === params[1]) };
    }
    throw new Error(`FakePlanDb does not understand: ${sql}`);
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-plans-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const backends: [string, () => PlanRepository][] = [
  ['files', () => new FilePlanRepository(join(dir, 'training-plans.json'))],
  ['postgres', () => new PostgresPlanRepository(new FakePlanDb())],
];

describe.each(backends)('%s plan repository', (_name, make) => {
  it('starts empty, then creates an active plan at revision 1', async () => {
    const repo = make();
    expect(await repo.active()).toBeNull();
    const stored = await repo.create(plan(), { source: 'analyst', summary: 'Created' });
    expect(stored).toMatchObject({ status: 'active', revision: 1 });
    expect(stored.id).toMatch(/^plan-/);
    expect((await repo.active())?.id).toBe(stored.id);
    expect((await repo.revisions(stored.id))[0]).toMatchObject({ revision: 1, source: 'analyst', summary: 'Created' });
  });

  it('archives the previous plan when a new one is created', async () => {
    const repo = make();
    const first = await repo.create(plan(), { source: 'analyst', summary: 'one' });
    const second = await repo.create(plan('strength'), { source: 'analyst', summary: 'two' });
    expect((await repo.active())?.id).toBe(second.id);
    expect((await repo.get(first.id))?.status).toBe('archived');
  });

  it('bumps the revision on update and refuses a stale one', async () => {
    const repo = make();
    const stored = await repo.create(plan(), { source: 'analyst', summary: 'Created' });
    const next = { ...stored.plan, title: 'Renamed' };
    const updated = await repo.update(stored.id, next, 1, { source: 'user', summary: 'Rename' });
    expect(updated.revision).toBe(2);
    expect(updated.plan.title).toBe('Renamed');
    await expect(repo.update(stored.id, next, 1, { source: 'user', summary: 'Again' })).rejects.toBeInstanceOf(PlanConflictError);
  });

  it('refuses to store an invalid plan', async () => {
    const repo = make();
    const bad = { ...plan(), durationWeeks: 0 } as TrainingPlan;
    await expect(repo.create(bad, { source: 'analyst', summary: 'x' })).rejects.toThrow(/invalid plan/);
  });

  it('reverts to an earlier revision as a new revision', async () => {
    const repo = make();
    const stored = await repo.create(plan(), { source: 'analyst', summary: 'Created' });
    await repo.update(stored.id, { ...stored.plan, title: 'Changed' }, 1, { source: 'analyst', summary: 'Change' });
    const reverted = await revertPlan(repo, stored.id, 1, { source: 'user', summary: 'Undo' });
    expect(reverted.revision).toBe(3);
    expect(reverted.plan.title).toBe(stored.plan.title);
    expect((await repo.revisions(stored.id)).map(r => r.summary)).toEqual(['Undo', 'Change', 'Created']);
  });

  it('archives and re-activates', async () => {
    const repo = make();
    const a = await repo.create(plan(), { source: 'analyst', summary: 'a' });
    const b = await repo.create(plan('endurance-10k'), { source: 'analyst', summary: 'b' });
    await repo.setStatus(a.id, 'active');
    expect((await repo.active())?.id).toBe(a.id);
    expect((await repo.get(b.id))?.status).toBe('archived');
    await repo.setStatus(a.id, 'archived');
    expect(await repo.active()).toBeNull();
  });
});

describe('postgres plans belong to one profile', () => {
  const as = (userId: string) => ({ slug: userId, primary: false, userId, userError: null, env: process.env });

  it('keeps each person’s active plan, list and revisions apart', async () => {
    const repo = new PostgresPlanRepository(new FakePlanDb());
    const alex = await runAsUser(as('alex'), () => repo.create(plan(), { source: 'analyst', summary: 'alex' }));
    const sam = await runAsUser(as('sam'), () => repo.create(plan('strength'), { source: 'user', summary: 'sam' }));

    // Creating Sam's plan did not archive Alex's.
    expect((await runAsUser(as('alex'), () => repo.active()))?.id).toBe(alex.id);
    expect((await runAsUser(as('sam'), () => repo.active()))?.id).toBe(sam.id);
    expect((await runAsUser(as('sam'), () => repo.list())).map(p => p.id)).toEqual([sam.id]);

    // Another person's plan is not found, not readable and not writable.
    expect(await runAsUser(as('sam'), () => repo.get(alex.id))).toBeNull();
    expect(await runAsUser(as('sam'), () => repo.revisions(alex.id))).toEqual([]);
    await expect(runAsUser(as('sam'), () => repo.setStatus(alex.id, 'archived'))).rejects.toThrow(/no plan/);
    await expect(
      runAsUser(as('sam'), () => repo.update(alex.id, alex.plan, alex.revision, { source: 'user', summary: 'x' }))
    ).rejects.toThrow(/no plan/);
    expect((await runAsUser(as('alex'), () => repo.get(alex.id)))?.status).toBe('active');
  });
});
