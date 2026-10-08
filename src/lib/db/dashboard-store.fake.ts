// ── An in-memory stand-in for dashboard_cards (tests only) ───────────────────
//
// Answers the exact statements in dashboard-store.ts, matched by prefix, so a
// route test runs the real store code against it. Synthetic rows only.

import { DASHBOARD_COLUMNS } from './dashboard-store';
import type { PoolLike } from './pool';

export interface FakeRow {
  id: string;
  mode: string;
  card_type: string;
  spec: unknown;
  schema_version: number;
  position: number;
  width: number;
  height: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

export class FakeDashboardPool implements PoolLike {
  rows: FakeRow[] = [];
  statements: string[] = [];
  private clock = Date.parse('2026-10-08T12:00:00Z');

  private tick() {
    this.clock += 1000;
    return new Date(this.clock);
  }
  private project(r: FakeRow) {
    const { mode: _mode, ...rest } = r;
    void _mode;
    return rest;
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    const cols = DASHBOARD_COLUMNS;

    if (sql.startsWith(`SELECT ${cols} FROM dashboard_cards WHERE mode = $1 ORDER BY position, id`)) {
      const rows = this.rows.filter(r => r.mode === params[0]).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      return { rows: rows.map(r => this.project(r)) };
    }
    if (sql.startsWith(`SELECT ${cols} FROM dashboard_cards WHERE id = $1 AND mode = $2`)) {
      return { rows: this.rows.filter(r => r.id === params[0] && r.mode === params[1]).map(r => this.project(r)) };
    }
    if (sql.startsWith('INSERT INTO dashboard_cards (id, mode, card_type, spec, schema_version, position, width, height) SELECT')) {
      const [id, mode, type, spec, version, w, h, cap] = params;
      const inMode = this.rows.filter(r => r.mode === mode);
      if (inMode.length >= Number(cap)) return { rows: [] };
      const row: FakeRow = {
        id: String(id),
        mode: String(mode),
        card_type: String(type),
        spec: JSON.parse(String(spec)),
        schema_version: Number(version),
        position: inMode.length ? Math.max(...inMode.map(r => r.position)) + 1 : 0,
        width: Number(w),
        height: Number(h),
        revision: 1,
        created_at: this.tick(),
        updated_at: this.tick(),
      };
      this.rows.push(row);
      return { rows: [this.project(row)] };
    }
    if (sql.startsWith('UPDATE dashboard_cards SET spec = $4::jsonb, schema_version = $5, width = $6, height = $7, revision = revision + 1')) {
      const row = this.rows.find(r => r.id === params[0] && r.mode === params[1] && r.revision === params[2]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        spec: JSON.parse(String(params[3])),
        schema_version: Number(params[4]),
        width: Number(params[5]),
        height: Number(params[6]),
        revision: row.revision + 1,
        updated_at: this.tick(),
      });
      return { rows: [this.project(row)] };
    }
    if (sql.startsWith('DELETE FROM dashboard_cards WHERE id = $1 AND mode = $2 AND revision = $3 RETURNING id')) {
      const row = this.rows.find(r => r.id === params[0] && r.mode === params[1] && r.revision === params[2]);
      if (!row) return { rows: [] };
      this.rows = this.rows.filter(r => r !== row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('WITH wanted AS ( SELECT o.id, (o.ord - 1)::int AS position FROM unnest($2::text[]) WITH ORDINALITY')) {
      const wanted = params[1] as string[];
      const cur = this.rows.filter(r => r.mode === params[0]);
      const valid =
        cur.length === wanted.length && new Set(wanted).size === wanted.length && wanted.every(id => cur.some(r => r.id === id));
      if (!valid) return { rows: [] };
      wanted.forEach((id, i) => {
        const row = cur.find(r => r.id === id)!;
        row.position = i;
        row.updated_at = this.tick();
      });
      return { rows: wanted.map(id => ({ id })) };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }
}
