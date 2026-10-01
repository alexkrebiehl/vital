// ── Training plan store (SERVER ONLY) ───────────────────
//
// Where plans live follows the rest of Vital's configuration
// (src/lib/db/backend.ts):
//
//   * a Postgres database is configured → training_plans / training_plan_revisions
//     (db/migrations/0007, src/lib/db/plan-store.ts);
//   * nothing configured                → one JSON file the server owns,
//         ./data/training-plans.json   (VITAL_TRAINING_PLAN_PATH overrides)
//
// Both backends expose the same repository, keep every write as a revision
// (for undo), allow at most one active plan, and refuse an update that names a
// stale revision.
//
// Plans are configuration — targets and stage choices — and never hold a
// measured set, so either backend may store them.

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveBackend } from '@/lib/db/backend';
import { getPool } from '@/lib/db/pool';
import {
  PlanConflictError,
  PlanNotFoundError,
  pgActivePlan,
  pgCreatePlan,
  pgGetPlan,
  pgListPlans,
  pgListRevisions,
  pgRevisionPlan,
  pgSetStatus,
  pgUpdatePlan,
  type PlanSqlClient,
} from '@/lib/db/plan-store';
import { validatePlan } from './validate';
import type { PlanChangeSource, PlanRevisionSummary, StoredPlan, TrainingPlan } from './types';

export { PlanConflictError, PlanNotFoundError };

export interface ChangeMeta {
  source: PlanChangeSource;
  summary: string;
}

export interface PlanRepository {
  readonly kind: 'postgres' | 'files';
  active(): Promise<StoredPlan | null>;
  get(id: string): Promise<StoredPlan | null>;
  list(limit?: number): Promise<StoredPlan[]>;
  create(plan: TrainingPlan, meta: ChangeMeta): Promise<StoredPlan>;
  update(id: string, plan: TrainingPlan, expectedRevision: number, meta: ChangeMeta): Promise<StoredPlan>;
  setStatus(id: string, status: 'active' | 'archived'): Promise<StoredPlan>;
  revisions(id: string, limit?: number): Promise<PlanRevisionSummary[]>;
  revisionPlan(id: string, revision: number): Promise<TrainingPlan | null>;
}

export function newPlanId(): string {
  return `plan-${randomUUID().slice(0, 8)}`;
}

function checked(plan: TrainingPlan): TrainingPlan {
  const v = validatePlan(plan);
  if (!v.ok) throw new Error(`Refusing to store an invalid plan: ${v.errors.slice(0, 5).join(' ')}`);
  return v.plan;
}

function summaryOf(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return (s || 'Plan updated').slice(0, 300);
}

// ── Postgres ────────────────────────────────────────────

export class PostgresPlanRepository implements PlanRepository {
  readonly kind = 'postgres' as const;
  constructor(private readonly client: PlanSqlClient) {}
  active() { return pgActivePlan(this.client); }
  get(id: string) { return pgGetPlan(this.client, id); }
  list(limit?: number) { return pgListPlans(this.client, limit); }
  async create(plan: TrainingPlan, meta: ChangeMeta) {
    return pgCreatePlan(this.client, newPlanId(), checked(plan), { source: meta.source, summary: summaryOf(meta.summary) });
  }
  async update(id: string, plan: TrainingPlan, expectedRevision: number, meta: ChangeMeta) {
    return pgUpdatePlan(this.client, id, checked(plan), expectedRevision, { source: meta.source, summary: summaryOf(meta.summary) });
  }
  setStatus(id: string, status: 'active' | 'archived') { return pgSetStatus(this.client, id, status); }
  revisions(id: string, limit?: number) { return pgListRevisions(this.client, id, limit); }
  revisionPlan(id: string, revision: number) { return pgRevisionPlan(this.client, id, revision); }
}

// ── JSON file ───────────────────────────────────────────

interface FileRevision extends PlanRevisionSummary {
  plan: TrainingPlan;
}

interface FileShape {
  version: 1;
  plans: StoredPlan[];
  revisions: FileRevision[];
}

/** Revisions kept per plan in the file store (the database keeps all). */
export const FILE_REVISIONS_PER_PLAN = 100;

export function planFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VITAL_TRAINING_PLAN_PATH?.trim();
  return override || join(process.cwd(), 'data', 'training-plans.json');
}

export class FilePlanRepository implements PlanRepository {
  readonly kind = 'files' as const;
  constructor(private readonly path: string, private readonly now: () => Date = () => new Date()) {}

  private read(): FileShape {
    if (!existsSync(this.path)) return { version: 1, plans: [], revisions: [] };
    const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>;
    const plans = (raw.plans ?? []).map(p => {
      const v = validatePlan(p.plan);
      if (!v.ok) throw new Error(`${this.path}: plan ${p.id} is not a valid plan: ${v.errors.slice(0, 3).join(' ')}`);
      return { ...p, plan: v.plan };
    });
    return { version: 1, plans, revisions: raw.revisions ?? [] };
  }

  private write(data: FileShape): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }

  private record(data: FileShape, stored: StoredPlan, meta: ChangeMeta): void {
    data.revisions.push({
      planId: stored.id,
      revision: stored.revision,
      source: meta.source,
      summary: summaryOf(meta.summary),
      createdAt: stored.updatedAt,
      plan: stored.plan,
    });
    const mine = data.revisions.filter(r => r.planId === stored.id);
    if (mine.length > FILE_REVISIONS_PER_PLAN) {
      const drop = new Set(mine.slice(0, mine.length - FILE_REVISIONS_PER_PLAN));
      data.revisions = data.revisions.filter(r => !drop.has(r));
    }
  }

  async active() {
    return this.read().plans.find(p => p.status === 'active') ?? null;
  }

  async get(id: string) {
    return this.read().plans.find(p => p.id === id) ?? null;
  }

  async list(limit = 20) {
    return [...this.read().plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  async create(plan: TrainingPlan, meta: ChangeMeta) {
    const data = this.read();
    const at = this.now().toISOString();
    for (const p of data.plans) if (p.status === 'active') Object.assign(p, { status: 'archived', updatedAt: at });
    const stored: StoredPlan = { id: newPlanId(), status: 'active', plan: checked(plan), revision: 1, createdAt: at, updatedAt: at };
    data.plans.push(stored);
    this.record(data, stored, meta);
    this.write(data);
    return stored;
  }

  async update(id: string, plan: TrainingPlan, expectedRevision: number, meta: ChangeMeta) {
    const data = this.read();
    const existing = data.plans.find(p => p.id === id);
    if (!existing) throw new PlanNotFoundError(`There is no plan "${id}".`);
    if (existing.revision !== expectedRevision) {
      throw new PlanConflictError(
        `The plan changed since revision ${expectedRevision} (it is now at ${existing.revision}). Reload it and apply the change again.`
      );
    }
    Object.assign(existing, { plan: checked(plan), revision: existing.revision + 1, updatedAt: this.now().toISOString() });
    this.record(data, existing, meta);
    this.write(data);
    return existing;
  }

  async setStatus(id: string, status: 'active' | 'archived') {
    const data = this.read();
    const target = data.plans.find(p => p.id === id);
    if (!target) throw new PlanNotFoundError(`There is no plan "${id}".`);
    const at = this.now().toISOString();
    if (status === 'active') {
      for (const p of data.plans) if (p.status === 'active' && p.id !== id) Object.assign(p, { status: 'archived', updatedAt: at });
    }
    Object.assign(target, { status, updatedAt: at });
    this.write(data);
    return target;
  }

  async revisions(id: string, limit = 50) {
    return this.read()
      .revisions.filter(r => r.planId === id)
      .sort((a, b) => b.revision - a.revision)
      .slice(0, limit)
      .map(({ plan: _plan, ...summary }) => summary);
  }

  async revisionPlan(id: string, revision: number) {
    const hit = this.read().revisions.find(r => r.planId === id && r.revision === revision);
    if (!hit) return null;
    const v = validatePlan(hit.plan);
    return v.ok ? v.plan : null;
  }
}

// ── Selection ───────────────────────────────────────────

/** The repository for this deployment. Throws when a configured database is invalid. */
export function planRepository(env: NodeJS.ProcessEnv = process.env): PlanRepository {
  const backend = resolveBackend(env);
  if (backend.kind === 'postgres') {
    const pool = getPool(env);
    if (!pool) throw new Error('A database is configured but no pool could be created.');
    return new PostgresPlanRepository(pool as unknown as PlanSqlClient);
  }
  return new FilePlanRepository(planFilePath(env));
}

// ── Higher-level operations ─────────────────────────────

/**
 * Put a plan back the way it was at `revision`. The restore is itself a new
 * revision, so it can be undone too.
 */
export async function revertPlan(
  repo: PlanRepository,
  id: string,
  revision: number,
  meta: ChangeMeta
): Promise<StoredPlan> {
  const current = await repo.get(id);
  if (!current) throw new PlanNotFoundError(`There is no plan "${id}".`);
  const plan = await repo.revisionPlan(id, revision);
  if (!plan) throw new PlanNotFoundError(`Plan "${id}" has no revision ${revision}.`);
  return repo.update(id, plan, current.revision, meta);
}
