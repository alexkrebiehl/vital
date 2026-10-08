import { describe, expect, it } from 'vitest';
import {
  CardConflictError,
  CardNotFoundError,
  DASHBOARD_COLUMNS,
  pgCreateCard,
  pgDeleteCard,
  pgListCards,
  pgReorderCards,
  pgReplaceCard,
} from './dashboard-store';
import { MAX_CARDS_PER_MODE } from '@/lib/dashboard/types';
import type { PoolLike } from './pool';

interface Row {
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

/** An in-memory stand-in for dashboard_cards, matching the store's statements by prefix. */
class FakeCards implements PoolLike {
  rows: Row[] = [];
  statements: string[] = [];
  /** Throw a unique violation on this many INSERTs before behaving. */
  duplicateOnInsert = 0;
  private clock = Date.parse('2026-10-08T12:00:00Z');

  private tick() {
    this.clock += 1000;
    return new Date(this.clock);
  }
  private project(r: Row) {
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
      if (this.duplicateOnInsert > 0) {
        this.duplicateOnInsert -= 1;
        throw Object.assign(new Error('duplicate key value violates unique constraint "dashboard_cards_mode_position"'), { code: '23505' });
      }
      const [id, mode, type, spec, version, w, h, cap] = [params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7]];
      const inMode = this.rows.filter(r => r.mode === mode);
      if (inMode.length >= Number(cap)) return { rows: [] };
      const row: Row = {
        id: String(id), mode: String(mode), card_type: String(type), spec: JSON.parse(String(spec)),
        schema_version: Number(version), position: inMode.length ? Math.max(...inMode.map(r => r.position)) + 1 : 0,
        width: Number(w), height: Number(h), revision: 1, created_at: this.tick(), updated_at: this.tick(),
      };
      this.rows.push(row);
      return { rows: [this.project(row)] };
    }
    if (sql.startsWith('UPDATE dashboard_cards SET spec = $4::jsonb, schema_version = $5, width = $6, height = $7, revision = revision + 1, updated_at = now() WHERE id = $1 AND mode = $2 AND revision = $3 RETURNING')) {
      const row = this.rows.find(r => r.id === params[0] && r.mode === params[1] && r.revision === params[2]);
      if (!row) return { rows: [] };
      Object.assign(row, { spec: JSON.parse(String(params[3])), schema_version: Number(params[4]), width: Number(params[5]), height: Number(params[6]), revision: row.revision + 1, updated_at: this.tick() });
      return { rows: [this.project(row)] };
    }
    if (sql.startsWith('DELETE FROM dashboard_cards WHERE id = $1 AND mode = $2 AND revision = $3 RETURNING id')) {
      const row = this.rows.find(r => r.id === params[0] && r.mode === params[1] && r.revision === params[2]);
      if (!row) return { rows: [] };
      this.rows = this.rows.filter(r => r !== row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('WITH wanted AS ( SELECT o.id, (o.ord - 1)::int AS position FROM unnest($2::text[]) WITH ORDINALITY')) {
      const mode = params[0];
      const wanted = params[1] as string[];
      const cur = this.rows.filter(r => r.mode === mode);
      const valid = cur.length === wanted.length && new Set(wanted).size === wanted.length && wanted.every(id => cur.some(r => r.id === id));
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

const spec = (metricId = 'resting_heart_rate') => ({ metricId, date: { kind: 'today' } });
const input = (metricId?: string) => ({ type: 'value', spec: spec(metricId), schemaVersion: 1, size: { w: 1, h: 1 } });

describe('dashboard store', () => {
  it('lists nothing before anything is created', async () => {
    expect(await pgListCards(new FakeCards(), 'demo')).toEqual([]);
  });

  it('appends at positions 0, 1, 2 and lists them in order', async () => {
    const db = new FakeCards();
    const a = await pgCreateCard(db, 'demo', input('resting_heart_rate'));
    const b = await pgCreateCard(db, 'demo', input('heart_rate_variability'));
    const c = await pgCreateCard(db, 'demo', input('vo2max'));
    expect([a, b, c].map(x => x.layout.order)).toEqual([0, 1, 2]);
    expect(a).toMatchObject({ id: expect.stringMatching(/^card-[0-9a-f-]{36}$/), type: 'value', status: 'ok', revision: 1, schemaVersion: 1, layout: { order: 0, w: 1, h: 1 } });
    expect((await pgListCards(db, 'demo')).map(x => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it('appends after a gap left by a delete', async () => {
    const db = new FakeCards();
    await pgCreateCard(db, 'demo', input());
    const b = await pgCreateCard(db, 'demo', input());
    await pgDeleteCard(db, 'demo', (await pgListCards(db, 'demo'))[0].id, 1);
    const c = await pgCreateCard(db, 'demo', input());
    expect(b.layout.order).toBe(1);
    expect(c.layout.order).toBe(2);
  });

  it('keeps modes apart: a live card is invisible to demo and answers not found', async () => {
    const db = new FakeCards();
    const live = await pgCreateCard(db, 'live', input());
    const demo = await pgCreateCard(db, 'demo', input());
    expect(live.layout.order).toBe(0);
    expect(demo.layout.order).toBe(0);
    expect((await pgListCards(db, 'demo')).map(c => c.id)).toEqual([demo.id]);
    expect((await pgListCards(db, 'live')).map(c => c.id)).toEqual([live.id]);
    await expect(pgReplaceCard(db, 'demo', live.id, { spec: spec(), schemaVersion: 1, size: { w: 1, h: 1 } }, 1)).rejects.toBeInstanceOf(CardNotFoundError);
    await expect(pgDeleteCard(db, 'demo', live.id, 1)).rejects.toBeInstanceOf(CardNotFoundError);
    expect(db.rows).toHaveLength(2);
  });

  it('refuses a card past the cap with a conflict, and the cap is per mode', async () => {
    const db = new FakeCards();
    for (let i = 0; i < MAX_CARDS_PER_MODE; i++) await pgCreateCard(db, 'demo', input());
    await expect(pgCreateCard(db, 'demo', input())).rejects.toThrow(CardConflictError);
    await expect(pgCreateCard(db, 'demo', input())).rejects.toThrow(/At most 48 cards/);
    expect(db.rows).toHaveLength(MAX_CARDS_PER_MODE);
    await expect(pgCreateCard(db, 'live', input())).resolves.toBeDefined();
  });

  it('create is one statement carrying the cap', async () => {
    const db = new FakeCards();
    await pgCreateCard(db, 'demo', input());
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toContain('WHERE (SELECT count(*) FROM dashboard_cards WHERE mode = $2) < $8');
  });

  it('retries a unique violation once, then reports a conflict', async () => {
    const once = new FakeCards();
    once.duplicateOnInsert = 1;
    await expect(pgCreateCard(once, 'demo', input())).resolves.toMatchObject({ layout: { order: 0 } });
    expect(once.statements).toHaveLength(2);

    const twice = new FakeCards();
    twice.duplicateOnInsert = 2;
    await expect(pgCreateCard(twice, 'demo', input())).rejects.toBeInstanceOf(CardConflictError);
    expect(twice.statements).toHaveLength(2);
    expect(twice.rows).toHaveLength(0);
  });

  it('rethrows any other database error untouched', async () => {
    const db = new FakeCards();
    db.query = async () => {
      throw Object.assign(new Error('connection lost'), { code: '08006' });
    };
    await expect(pgCreateCard(db, 'demo', input())).rejects.toThrow('connection lost');
  });

  it('replaces a card at the right revision and bumps it', async () => {
    const db = new FakeCards();
    const a = await pgCreateCard(db, 'demo', input('resting_heart_rate'));
    const next = await pgReplaceCard(db, 'demo', a.id, { spec: spec('vo2max'), schemaVersion: 1, size: { w: 1, h: 1 } }, 1);
    expect(next).toMatchObject({ id: a.id, revision: 2, spec: spec('vo2max'), layout: { order: 0 } });
  });

  it('a stale revision is a conflict that carries the current card', async () => {
    const db = new FakeCards();
    const a = await pgCreateCard(db, 'demo', input());
    await pgReplaceCard(db, 'demo', a.id, { spec: spec('vo2max'), schemaVersion: 1, size: { w: 1, h: 1 } }, 1);
    const err = await pgReplaceCard(db, 'demo', a.id, { spec: spec(), schemaVersion: 1, size: { w: 1, h: 1 } }, 1).catch(e => e);
    expect(err).toBeInstanceOf(CardConflictError);
    expect(err.card).toMatchObject({ id: a.id, revision: 2, spec: spec('vo2max') });
    expect(db.rows[0].spec).toEqual(spec('vo2max'));
  });

  it('replacing or deleting an unknown id is not found', async () => {
    const db = new FakeCards();
    await expect(pgReplaceCard(db, 'demo', 'card-nope', { spec: spec(), schemaVersion: 1, size: { w: 1, h: 1 } }, 1)).rejects.toBeInstanceOf(CardNotFoundError);
    await expect(pgDeleteCard(db, 'demo', 'card-nope', 1)).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('deletes at the right revision; a stale delete is a conflict and removes nothing', async () => {
    const db = new FakeCards();
    const a = await pgCreateCard(db, 'demo', input());
    const stale = await pgDeleteCard(db, 'demo', a.id, 7).catch(e => e);
    expect(stale).toBeInstanceOf(CardConflictError);
    expect(stale.card).toMatchObject({ id: a.id, revision: 1 });
    expect(db.rows).toHaveLength(1);
    await pgDeleteCard(db, 'demo', a.id, 1);
    expect(db.rows).toHaveLength(0);
  });

  describe('reorder', () => {
    async function three() {
      const db = new FakeCards();
      const cards = [await pgCreateCard(db, 'demo', input()), await pgCreateCard(db, 'demo', input()), await pgCreateCard(db, 'demo', input())];
      return { db, ids: cards.map(c => c.id) };
    }

    it('applies a full permutation with ONE statement and returns the new order', async () => {
      const { db, ids } = await three();
      const before = db.statements.length;
      const next = await pgReorderCards(db, 'demo', [ids[2], ids[0], ids[1]]);
      expect(next.map(c => c.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect(next.map(c => c.layout.order)).toEqual([0, 1, 2]);
      const sent = db.statements.slice(before);
      expect(sent).toHaveLength(2); // the reorder, then the re-list that answers it
      expect(sent.filter(s => s.startsWith('WITH wanted AS'))).toHaveLength(1);
    });

    it('does not bump revisions', async () => {
      const { db, ids } = await three();
      await pgReorderCards(db, 'demo', [ids[1], ids[0], ids[2]]);
      expect(db.rows.map(r => r.revision)).toEqual([1, 1, 1]);
    });

    it('a missing, duplicated, unknown or other-mode id is a conflict and changes nothing', async () => {
      const { db, ids } = await three();
      const other = await pgCreateCard(db, 'live', input());
      const before = JSON.stringify(db.rows);
      for (const order of [[ids[0], ids[1]], [ids[0], ids[0], ids[1]], [ids[0], ids[1], 'card-unknown'], [ids[0], ids[1], other.id], [...ids, ids[0]]]) {
        await expect(pgReorderCards(db, 'demo', order)).rejects.toThrow('The order must name every card exactly once; reload and try again.');
        expect(JSON.stringify(db.rows)).toBe(before);
      }
    });

    it('an empty order is fine on an empty mode, and a conflict when the mode holds cards', async () => {
      await expect(pgReorderCards(new FakeCards(), 'demo', [])).resolves.toEqual([]);
      const { db } = await three();
      const before = JSON.stringify(db.rows);
      await expect(pgReorderCards(db, 'demo', [])).rejects.toBeInstanceOf(CardConflictError);
      expect(JSON.stringify(db.rows)).toBe(before);
    });
  });

  it('serves unreadable rows instead of dropping them', async () => {
    const db = new FakeCards();
    const good = await pgCreateCard(db, 'demo', input());
    db.rows.push({ id: 'card-new', mode: 'demo', card_type: 'gauge', spec: { x: 1 }, schema_version: 1, position: 5, width: 2, height: 2, revision: 3, created_at: new Date(), updated_at: new Date() });
    db.rows.push({ id: 'card-bad', mode: 'demo', card_type: 'value', spec: { metricId: 'gone' }, schema_version: 1, position: 6, width: 1, height: 1, revision: 1, created_at: new Date(), updated_at: new Date() });
    const cards = await pgListCards(db, 'demo');
    expect(cards.map(c => [c.id, c.status])).toEqual([[good.id, 'ok'], ['card-new', 'unreadable'], ['card-bad', 'unreadable']]);
    expect(cards[1]).toMatchObject({ spec: null, layout: { order: 5, w: 2, h: 2 } });
  });

  it('holds configuration only: no statement or row carries a value-like column', async () => {
    const db = new FakeCards();
    const a = await pgCreateCard(db, 'demo', input());
    await pgReplaceCard(db, 'demo', a.id, { spec: spec(), schemaVersion: 1, size: { w: 1, h: 1 } }, 1);
    await pgListCards(db, 'demo');
    expect(DASHBOARD_COLUMNS.split(', ')).toEqual(['id', 'card_type', 'spec', 'schema_version', 'position', 'width', 'height', 'revision', 'created_at', 'updated_at']);
    expect(Object.keys(db.rows[0]).sort()).toEqual(['card_type', 'created_at', 'height', 'id', 'mode', 'position', 'revision', 'schema_version', 'spec', 'updated_at', 'width']);
    expect(db.statements.join(' ')).not.toMatch(/\b(value|reading|total|average|score)\b\s*[,)=]/i);
    // the stored spec names a metric and day keys, never a number from the data
    expect(Object.keys(db.rows[0].spec as object).sort()).toEqual(['date', 'metricId']);
  });
});
