// ── Training plan store: Postgres (SERVER ONLY) ──────────
//
// The database half of the plan repository (see src/lib/routine/store.ts for
// the file half and the backend choice). Every function takes its client, so the
// SQL and row mapping run against an injected stand-in in the offline tests.
//
// CONFIGURATION ONLY (db/migrations/0007): a plan holds targets and stage
// choices, never a measured set. Plans are re-validated on the way out, so a
// hand-edited row cannot put an unknown shape in front of the engine.
//
// Writes that touch more than one row (archive the old active plan and insert
// the new one; bump a plan and record its revision) run in one transaction, and
// an update names the revision it was based on — a stale one is refused rather
// than silently overwriting a newer change.

import { validatePlan } from '@/lib/routine/validate';
import {
  PLAN_SCHEMA_VERSION,
  type PlanChangeSource,
  type PlanRevisionSummary,
  type StoredPlan,
  type TrainingPlan,
} from '@/lib/routine/types';
import type { PoolLike } from './pool';

export interface TxClient extends PoolLike {
  release?: () => void;
}

/** A pool (or test double) that can hand out a client for a transaction. */
export interface PlanSqlClient extends PoolLike {
  connect?: () => Promise<TxClient>;
}

export class PlanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanConflictError';
  }
}

export class PlanNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanNotFoundError';
  }
}

const PLAN_COLUMNS = 'id, status, plan, revision, created_at, updated_at';

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

export function toStoredPlan(row: Record<string, unknown>): StoredPlan {
  const raw = typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan;
  const validated = validatePlan(raw);
  if (!validated.ok) {
    throw new Error(`Stored plan ${String(row.id)} is not a valid plan: ${validated.errors.slice(0, 3).join(' ')}`);
  }
  return {
    id: String(row.id),
    status: row.status === 'archived' ? 'archived' : 'active',
    plan: validated.plan,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function inTransaction<T>(client: PlanSqlClient, fn: (tx: PoolLike) => Promise<T>): Promise<T> {
  const tx: TxClient = client.connect ? await client.connect() : client;
  try {
    await tx.query('BEGIN');
    const out = await fn(tx);
    await tx.query('COMMIT');
    return out;
  } catch (error) {
    try {
      await tx.query('ROLLBACK');
    } catch {
      // The connection is gone; the original error is the one worth reporting.
    }
    throw error;
  } finally {
    tx.release?.();
  }
}

export async function pgActivePlan(client: PlanSqlClient): Promise<StoredPlan | null> {
  const result = await client.query(`SELECT ${PLAN_COLUMNS} FROM training_plans WHERE status = 'active' LIMIT 1`);
  return result.rows[0] ? toStoredPlan(result.rows[0]) : null;
}

export async function pgGetPlan(client: PlanSqlClient, id: string): Promise<StoredPlan | null> {
  const result = await client.query(`SELECT ${PLAN_COLUMNS} FROM training_plans WHERE id = $1`, [id]);
  return result.rows[0] ? toStoredPlan(result.rows[0]) : null;
}

export async function pgListPlans(client: PlanSqlClient, limit = 20): Promise<StoredPlan[]> {
  const result = await client.query(
    `SELECT ${PLAN_COLUMNS} FROM training_plans ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map(toStoredPlan);
}

const INSERT_REVISION = `
  INSERT INTO training_plan_revisions (plan_id, revision, source, summary, plan)
  VALUES ($1, $2, $3, $4, $5)
`;

/** Insert `plan` as the active plan, archiving whichever plan was active. */
export async function pgCreatePlan(
  client: PlanSqlClient,
  id: string,
  plan: TrainingPlan,
  meta: { source: PlanChangeSource; summary: string }
): Promise<StoredPlan> {
  return inTransaction(client, async tx => {
    await tx.query(`UPDATE training_plans SET status = 'archived', updated_at = now() WHERE status = 'active'`);
    const result = await tx.query(
      `INSERT INTO training_plans (id, status, plan, schema_version, revision)
       VALUES ($1, 'active', $2, $3, 1)
       RETURNING ${PLAN_COLUMNS}`,
      [id, JSON.stringify(plan), PLAN_SCHEMA_VERSION]
    );
    await tx.query(INSERT_REVISION, [id, 1, meta.source, meta.summary, JSON.stringify(plan)]);
    return toStoredPlan(result.rows[0]);
  });
}

/** Replace a plan's document, if it is still at `expectedRevision`. */
export async function pgUpdatePlan(
  client: PlanSqlClient,
  id: string,
  plan: TrainingPlan,
  expectedRevision: number,
  meta: { source: PlanChangeSource; summary: string }
): Promise<StoredPlan> {
  return inTransaction(client, async tx => {
    const result = await tx.query(
      `UPDATE training_plans
          SET plan = $2, schema_version = $3, revision = revision + 1, updated_at = now()
        WHERE id = $1 AND revision = $4
        RETURNING ${PLAN_COLUMNS}`,
      [id, JSON.stringify(plan), PLAN_SCHEMA_VERSION, expectedRevision]
    );
    const row = result.rows[0];
    if (!row) {
      const exists = await tx.query(`SELECT revision FROM training_plans WHERE id = $1`, [id]);
      if (!exists.rows[0]) throw new PlanNotFoundError(`There is no plan "${id}".`);
      throw new PlanConflictError(
        `The plan changed since revision ${expectedRevision} (it is now at ${Number(exists.rows[0].revision)}). Reload it and apply the change again.`
      );
    }
    const stored = toStoredPlan(row);
    await tx.query(INSERT_REVISION, [id, stored.revision, meta.source, meta.summary, JSON.stringify(plan)]);
    return stored;
  });
}

/** Archive or re-activate a plan. Re-activating archives whichever plan is active. */
export async function pgSetStatus(client: PlanSqlClient, id: string, status: 'active' | 'archived'): Promise<StoredPlan> {
  return inTransaction(client, async tx => {
    if (status === 'active') {
      await tx.query(`UPDATE training_plans SET status = 'archived', updated_at = now() WHERE status = 'active' AND id <> $1`, [id]);
    }
    const result = await tx.query(
      `UPDATE training_plans SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
      [id, status]
    );
    if (!result.rows[0]) throw new PlanNotFoundError(`There is no plan "${id}".`);
    return toStoredPlan(result.rows[0]);
  });
}

export async function pgListRevisions(client: PlanSqlClient, id: string, limit = 50): Promise<PlanRevisionSummary[]> {
  const result = await client.query(
    `SELECT plan_id, revision, source, summary, created_at
       FROM training_plan_revisions
      WHERE plan_id = $1
      ORDER BY revision DESC
      LIMIT $2`,
    [id, limit]
  );
  return result.rows.map(row => ({
    planId: String(row.plan_id),
    revision: Number(row.revision),
    source: row.source === 'user' ? 'user' : 'analyst',
    summary: String(row.summary),
    createdAt: iso(row.created_at),
  }));
}

export async function pgRevisionPlan(client: PlanSqlClient, id: string, revision: number): Promise<TrainingPlan | null> {
  const result = await client.query(
    `SELECT plan FROM training_plan_revisions WHERE plan_id = $1 AND revision = $2`,
    [id, revision]
  );
  const row = result.rows[0];
  if (!row) return null;
  const validated = validatePlan(typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan);
  return validated.ok ? validated.plan : null;
}
