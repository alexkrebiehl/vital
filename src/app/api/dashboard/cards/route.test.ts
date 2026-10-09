// ── Route tests for /api/dashboard/cards, with an INJECTED pool ──────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';
import { FakeDashboardPool } from '@/lib/db/dashboard-store.fake';

const holder: { client: PoolLike | null } = { client: null };

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.client,
  closePool: async () => {},
}));

import { GET, POST, PUT } from './route';
import { registerCardSchema } from '@/lib/dashboard/card-schemas';
import { MAX_CARDS_PER_MODE } from '@/lib/dashboard/types';

let db: FakeDashboardPool;

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/dashboard/cards', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

const value = (metricId = 'resting_heart_rate', date: unknown = { kind: 'today' }) => ({ type: 'value', spec: { metricId, date } });

async function create(metricId?: string) {
  const res = await POST(req('POST', value(metricId)));
  expect(res.status).toBe(201);
  return (await res.json()).card as { id: string; revision: number };
}

const writes = () => db.statements.filter(s => !s.startsWith('SELECT'));

beforeEach(() => {
  db = new FakeDashboardPool();
  holder.client = db;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/dashboard/cards', () => {
  it('answers 200 with the mode, the cards in order and the limit', async () => {
    const a = await create('resting_heart_rate');
    const b = await create('heart_rate_variability');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('demo');
    expect(body.limits).toEqual({ maxCards: MAX_CARDS_PER_MODE });
    expect(body.cards.map((c: { id: string }) => c.id)).toEqual([a.id, b.id]);
  });

  it('is private and uncacheable', async () => {
    expect((await GET()).headers.get('Cache-Control')).toBe('no-store, private');
  });
});

describe('POST /api/dashboard/cards', () => {
  it('creates a card with the default size and answers 201', async () => {
    const res = await POST(req('POST', value()));
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    const { card } = await res.json();
    expect(card).toMatchObject({ type: 'value', status: 'ok', revision: 1, layout: { order: 0, w: 1, h: 1 }, spec: { metricId: 'resting_heart_rate', date: { kind: 'today' } } });
  });

  it.each([
    ['a body that is not JSON', '{nope', /must be JSON/],
    ['an unknown top-level field', { ...value(), mode: 'live' }, /mode/],
    ['a missing type', { spec: value().spec }, /needs a type/],
    ['an unknown type', { type: 'nope', spec: {} }, /no card type "nope"/],
    ['an unknown metric', value('not_a_metric'), /no metric "not_a_metric"/],
    ['a range that is not a date', value('step_count', { kind: 'range', start: 'soon', end: '2026-10-02' }), /YYYY-MM-DD/],
    ['a range with an impossible date', value('step_count', { kind: 'range', start: '2026-02-30', end: '2026-03-02' }), /real calendar date/],
    ['a range that ends before it starts', value('step_count', { kind: 'range', start: '2026-10-05', end: '2026-10-01' }), /on or before/],
    ['a range that is too long', value('step_count', { kind: 'range', start: '1990-01-01', end: '2026-10-01' }), /at most/],
    ['an unknown date kind', value('step_count', { kind: 'forever' }), /today, yesterday or range/],
    ['an unknown date field', value('step_count', { kind: 'today', extra: 1 }), /unknown field "extra"/],
    ['an unknown spec field', { type: 'value', spec: { metricId: 'step_count', date: { kind: 'today' }, color: 'red' } }, /unknown field "color"/],
    ['a size the type does not offer', { ...value(), size: { w: 2, h: 2 } }, /cannot be 2×2/],
    ['an oversized spec', { type: 'value', spec: { metricId: 'x'.repeat(3000), date: { kind: 'today' } } }, /larger than/],
  ])('answers 400 for %s and stores nothing', async (_n, body, message) => {
    const res = await POST(req('POST', body));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect((await res.json()).error).toMatch(message);
    expect(db.rows).toEqual([]);
  });

  it('answers 409 at the cap', async () => {
    for (let i = 0; i < MAX_CARDS_PER_MODE; i++) await create();
    const res = await POST(req('POST', value()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/At most 48/);
    expect(db.rows).toHaveLength(MAX_CARDS_PER_MODE);
  });

  it('stores a card as live when the server is in live mode, and demo does not show it', async () => {
    vi.stubEnv('VITAL_DATA_MODE', 'live');
    const { id } = await create();
    expect(db.rows.map(r => [r.id, r.mode])).toEqual([[id, 'live']]);
    expect((await (await GET()).json()).cards).toHaveLength(1);
    vi.stubEnv('VITAL_DATA_MODE', '');
    const demo = await (await GET()).json();
    expect(demo.mode).toBe('demo');
    expect(demo.cards).toEqual([]);
  });
});

describe('PUT /api/dashboard/cards (reorder)', () => {
  it('reorders with one write and answers 200 with the cards in the new order', async () => {
    const a = await create('resting_heart_rate');
    const b = await create('heart_rate_variability');
    const c = await create('vo2max');
    const before = writes().length;
    const res = await PUT(req('PUT', { order: [c.id, a.id, b.id] }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect((await res.json()).cards.map((x: { id: string }) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(writes().length - before).toBe(1);
  });

  it.each([
    ['an order that is not an array', { order: 'a' }],
    ['an order with a non-string', { order: [1] }],
    ['a missing order', {}],
    ['an unknown field', { order: [], extra: 1 }],
  ])('answers 400 for %s', async (_n, body) => {
    expect((await PUT(req('PUT', body))).status).toBe(400);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await PUT(req('PUT', '{nope'))).status).toBe(400);
  });

  it('answers 409 and changes nothing when the order omits or duplicates a card', async () => {
    const a = await create();
    const b = await create();
    for (const order of [[a.id], [a.id, a.id], [a.id, b.id, 'card-other']]) {
      const res = await PUT(req('PUT', { order }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/every card exactly once/);
    }
    expect(db.rows.map(r => r.id)).toEqual([a.id, b.id]);
    expect(db.rows.map(r => r.position)).toEqual([0, 1]);
  });
});

describe('without a database', () => {
  it.each([
    ['GET', () => GET()],
    ['POST', () => POST(req('POST', value()))],
    ['PUT', () => PUT(req('PUT', { order: [] }))],
  ])('%s answers 503 with the reason', async (_m, call) => {
    holder.client = null;
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect((await res.json()).error).toMatch(/No Postgres database is configured/);
  });
});

describe('a store failure', () => {
  it('answers 500 with the message', async () => {
    holder.client = { query: async () => { throw new Error('connection refused'); } };
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('connection refused');
  });
});

describe('registry openness', () => {
  it('serves a card type registered later with no route change', async () => {
    const unregister = registerCardSchema({
      type: 'probe',
      version: 1,
      label: 'Probe',
      sizes: [{ w: 2, h: 1 }],
      defaultSize: { w: 2, h: 1 },
      migrate: spec => spec,
      validate: input =>
        typeof input === 'object' && input !== null && typeof (input as { note?: unknown }).note === 'string'
          ? { ok: true, spec: { note: (input as { note: string }).note } }
          : { ok: false, errors: ['A probe needs a note.'] },
    });
    try {
      const bad = await POST(req('POST', { type: 'probe', spec: {} }));
      expect(bad.status).toBe(400);
      const res = await POST(req('POST', { type: 'probe', spec: { note: 'hello' } }));
      expect(res.status).toBe(201);
      const { card } = await res.json();
      expect(card).toMatchObject({ type: 'probe', status: 'ok', spec: { note: 'hello' }, layout: { w: 2, h: 1 } });
      const listed = (await (await GET()).json()).cards;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: card.id, type: 'probe', status: 'ok' });
    } finally {
      unregister();
    }
  });
});
