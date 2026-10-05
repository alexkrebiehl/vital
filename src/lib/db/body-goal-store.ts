// ── Body goal store: Postgres (SERVER ONLY) ──────────────
//
// The `body_goals` table (db/migrations/0012). Postgres is the only backend,
// like the profile: a missing database is reported, never replaced by a file.
// Every pg* function takes its client, so the SQL and row mapping run against
// an injected stand-in in the offline tests.
//
// CONFIGURATION ONLY: a target, a pace and the day the goal was set. Rows are
// re-validated on the way out, so a hand-edited row cannot put an unknown shape
// in front of the engine.
//
// At most one goal is active. Starting a new goal archives the active one in the
// same transaction, and every write names the revision it was based on — a stale
// one is refused rather than silently overwriting a change made elsewhere.

import { randomUUID } from 'crypto';
import {
  validateBodyGoalInput,
  type BodyGoal,
  type BodyGoalInput,
  type BodyGoalsState,
} from '@/lib/body-goal/types';
import { NO_DATABASE_CONFIGURED_REASON } from './backend';
import { getPool, type PoolLike } from './pool';

export const BODY_GOAL_SCHEMA_VERSION = 1;

interface TxClient extends PoolLike {
  release?: () => void;
}

export interface GoalSqlClient extends PoolLike {
  connect?: () => Promise<TxClient>;
}

export class BodyGoalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyGoalConflictError';
  }
}

// `to_char` rather than the raw DATE, for the reason given in profile-store.ts:
// node-postgres would parse a DATE into local midnight and shift the day.
const GOAL_COLUMNS = `id, kind, target, pace_kg_per_week,
  to_char(started_on, 'YYYY-MM-DD') AS started_on,
  to_char(ended_on, 'YYYY-MM-DD') AS ended_on,
  status, revision, updated_at`;

/** Archived goals kept in the history the API serves. */
const HISTORY_LIMIT = 20;

export function toBodyGoal(row: Record<string, unknown>): BodyGoal {
  const pace = row.pace_kg_per_week;
  const validated = validateBodyGoalInput({
    kind: row.kind,
    target: Number(row.target),
    paceKgPerWeek: pace === null || pace === undefined ? null : Number(pace),
  });
  if (!validated.ok) {
    throw new Error(`Stored body goal ${String(row.id)} is not a valid goal: ${validated.errors.join(' ')}`);
  }
  return {
    id: String(row.id),
    ...validated.input,
    startedOn: String(row.started_on),
    endedOn: row.ended_on ? String(row.ended_on) : null,
    status: row.status === 'active' ? 'active' : 'archived',
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

async function inTransaction<T>(client: GoalSqlClient, fn: (tx: PoolLike) => Promise<T>): Promise<T> {
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

export async function pgReadGoals(client: GoalSqlClient): Promise<BodyGoalsState> {
  const result = await client.query(
    `SELECT ${GOAL_COLUMNS} FROM body_goals
      ORDER BY (status = 'active') DESC, started_on DESC, created_at DESC
      LIMIT $1`,
    [HISTORY_LIMIT + 1]
  );
  const goals = result.rows.map(toBodyGoal);
  return {
    active: goals.find(g => g.status === 'active') ?? null,
    history: goals.filter(g => g.status === 'archived').slice(0, HISTORY_LIMIT),
  };
}

/** Refuse when the active goal is not the one the writer last saw. */
async function checkActive(tx: PoolLike, expectedRevision: number | null): Promise<Record<string, unknown> | null> {
  const result = await tx.query(`SELECT id, revision FROM body_goals WHERE status = 'active' LIMIT 1`);
  const active = result.rows[0] ?? null;
  const actual = active ? Number(active.revision) : null;
  if (actual !== expectedRevision) {
    throw new BodyGoalConflictError(
      active
        ? `The goal changed since you loaded it (it is now at revision ${actual}). Reload it and try again.`
        : 'The goal was ended since you loaded it. Reload and try again.'
    );
  }
  return active;
}

/** Start a new goal on `today`, archiving the active one. `expectedRevision` is the active goal's, or null for none. */
export async function pgStartGoal(
  client: GoalSqlClient,
  input: BodyGoalInput,
  today: string,
  expectedRevision: number | null
): Promise<BodyGoal> {
  return inTransaction(client, async tx => {
    await checkActive(tx, expectedRevision);
    await tx.query(
      `UPDATE body_goals SET status = 'archived', ended_on = $1, updated_at = now() WHERE status = 'active'`,
      [today]
    );
    const result = await tx.query(
      `INSERT INTO body_goals (id, kind, target, pace_kg_per_week, started_on, status, schema_version, revision)
       VALUES ($1, $2, $3, $4, $5, 'active', ${BODY_GOAL_SCHEMA_VERSION}, 1)
       RETURNING ${GOAL_COLUMNS}`,
      [randomUUID(), input.kind, input.target, input.paceKgPerWeek, today]
    );
    return toBodyGoal(result.rows[0]);
  });
}

/** Change the active goal's target or pace in place, keeping its start day. */
export async function pgUpdateGoal(
  client: GoalSqlClient,
  input: BodyGoalInput,
  expectedRevision: number
): Promise<BodyGoal> {
  return inTransaction(client, async tx => {
    await checkActive(tx, expectedRevision);
    const result = await tx.query(
      `UPDATE body_goals
          SET kind = $1, target = $2, pace_kg_per_week = $3, schema_version = ${BODY_GOAL_SCHEMA_VERSION},
              revision = revision + 1, updated_at = now()
        WHERE status = 'active' AND revision = $4
        RETURNING ${GOAL_COLUMNS}`,
      [input.kind, input.target, input.paceKgPerWeek, expectedRevision]
    );
    if (!result.rows[0]) throw new BodyGoalConflictError('The goal changed while it was being saved. Reload it and try again.');
    return toBodyGoal(result.rows[0]);
  });
}

/** End the active goal on `today`. */
export async function pgEndGoal(client: GoalSqlClient, today: string, expectedRevision: number): Promise<void> {
  await inTransaction(client, async tx => {
    await checkActive(tx, expectedRevision);
    await tx.query(
      `UPDATE body_goals SET status = 'archived', ended_on = $1, updated_at = now() WHERE status = 'active'`,
      [today]
    );
  });
}

// ── Process-wide wrappers ───────────────────────────────

function poolOrThrow(env: NodeJS.ProcessEnv): GoalSqlClient {
  const pool = getPool(env);
  if (!pool) throw new Error(NO_DATABASE_CONFIGURED_REASON);
  return pool as unknown as GoalSqlClient;
}

export function readBodyGoals(env: NodeJS.ProcessEnv = process.env): Promise<BodyGoalsState> {
  return pgReadGoals(poolOrThrow(env));
}

export function startBodyGoal(input: BodyGoalInput, today: string, expectedRevision: number | null, env: NodeJS.ProcessEnv = process.env) {
  return pgStartGoal(poolOrThrow(env), input, today, expectedRevision);
}

export function updateBodyGoal(input: BodyGoalInput, expectedRevision: number, env: NodeJS.ProcessEnv = process.env) {
  return pgUpdateGoal(poolOrThrow(env), input, expectedRevision);
}

export function endBodyGoal(today: string, expectedRevision: number, env: NodeJS.ProcessEnv = process.env) {
  return pgEndGoal(poolOrThrow(env), today, expectedRevision);
}
