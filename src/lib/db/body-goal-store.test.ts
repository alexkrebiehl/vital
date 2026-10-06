import { describe, expect, it } from 'vitest';
import {
  BodyGoalConflictError,
  pgEndGoal,
  pgReadGoals,
  pgStartGoal,
  pgUpdateGoal,
  toBodyGoal,
  type GoalSqlClient,
} from './body-goal-store';

/** An in-memory stand-in for the body_goals table, matching the store's statements. */
class FakeGoals implements GoalSqlClient {
  rows: Record<string, unknown>[] = [];
  statements: string[] = [];
  private clock = Date.parse('2026-10-04T12:00:00Z');

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.startsWith("SELECT id, revision FROM body_goals WHERE status = 'active'")) {
      return { rows: this.rows.filter(r => r.status === 'active') };
    }
    if (sql.startsWith('SELECT id, kind, target')) {
      const sorted = [...this.rows].sort((a, b) =>
        a.status !== b.status ? (a.status === 'active' ? -1 : 1) : String(b.started_on).localeCompare(String(a.started_on)) || String(b.updated_at).localeCompare(String(a.updated_at))
      );
      return { rows: sorted.slice(0, params[0] as number) };
    }
    if (sql.startsWith("UPDATE body_goals SET status = 'archived'")) {
      for (const r of this.rows) if (r.status === 'active') Object.assign(r, { status: 'archived', ended_on: params[0], updated_at: this.tick() });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO body_goals')) {
      if (this.rows.some(r => r.status === 'active')) throw new Error('unique violation: body_goals_one_active');
      const row = {
        id: params[0], kind: params[1], target: String(params[2]), pace_kg_per_week: params[3] === null ? null : String(params[3]),
        started_on: params[4], ended_on: null, status: 'active', revision: 1, updated_at: this.tick(),
      };
      this.rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE body_goals SET kind = $1')) {
      const row = this.rows.find(r => r.status === 'active' && r.revision === params[3]);
      if (!row) return { rows: [] };
      Object.assign(row, { kind: params[0], target: String(params[1]), pace_kg_per_week: params[2] === null ? null : String(params[2]), revision: (row.revision as number) + 1, updated_at: this.tick() });
      return { rows: [row] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }
}

describe('body goal store', () => {
  it('reads nothing before a goal is set', async () => {
    expect(await pgReadGoals(new FakeGoals())).toEqual({ active: null, history: [] });
  });

  it('starts a goal, edits it in place, and archives it when a new one starts', async () => {
    const db = new FakeGoals();
    const first = await pgStartGoal(db, { kind: 'body_fat', target: 15, paceKgPerWeek: null }, '2026-09-13', null);
    expect(first).toMatchObject({ kind: 'body_fat', target: 15, paceKgPerWeek: null, startedOn: '2026-09-13', status: 'active', revision: 1 });

    const edited = await pgUpdateGoal(db, { kind: 'body_fat', target: 14, paceKgPerWeek: -0.5 }, 1);
    expect(edited).toMatchObject({ target: 14, paceKgPerWeek: -0.5, startedOn: '2026-09-13', revision: 2 });

    const second = await pgStartGoal(db, { kind: 'weight', target: 80, paceKgPerWeek: 0.2 }, '2026-11-20', 2);
    expect(second).toMatchObject({ kind: 'weight', startedOn: '2026-11-20' });

    const state = await pgReadGoals(db);
    expect(state.active?.id).toBe(second.id);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ id: first.id, status: 'archived', endedOn: '2026-11-20' });
  });

  it('refuses a stale revision instead of overwriting a newer change', async () => {
    const db = new FakeGoals();
    await pgStartGoal(db, { kind: 'weight', target: 75, paceKgPerWeek: null }, '2026-10-01', null);
    await pgUpdateGoal(db, { kind: 'weight', target: 74, paceKgPerWeek: null }, 1);
    await expect(pgUpdateGoal(db, { kind: 'weight', target: 73, paceKgPerWeek: null }, 1)).rejects.toBeInstanceOf(BodyGoalConflictError);
    await expect(pgStartGoal(db, { kind: 'weight', target: 73, paceKgPerWeek: null }, '2026-10-02', null)).rejects.toBeInstanceOf(BodyGoalConflictError);
    expect(db.statements).toContain('ROLLBACK');
  });

  it('ends the active goal', async () => {
    const db = new FakeGoals();
    await pgStartGoal(db, { kind: 'weight', target: 75, paceKgPerWeek: null }, '2026-10-01', null);
    await pgEndGoal(db, '2026-10-04', 1);
    const state = await pgReadGoals(db);
    expect(state.active).toBeNull();
    expect(state.history[0].endedOn).toBe('2026-10-04');
    await expect(pgEndGoal(db, '2026-10-04', 1)).rejects.toBeInstanceOf(BodyGoalConflictError);
  });

  it('refuses a stored row that is not a valid goal', () => {
    expect(() => toBodyGoal({ id: 'x', kind: 'weight', target: '9000', pace_kg_per_week: null, started_on: '2026-10-01', status: 'active', revision: 1, updated_at: '2026-10-01T00:00:00Z' })).toThrow(/not a valid goal/);
  });
});
