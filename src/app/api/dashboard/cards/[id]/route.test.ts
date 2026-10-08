// ── Route tests for /api/dashboard/cards/:id, with an INJECTED pool ──────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';
import { FakeDashboardPool } from '@/lib/db/dashboard-store.fake';

const holder: { client: PoolLike | null } = { client: null };

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.client,
  closePool: async () => {},
}));

import { DELETE, PUT } from './route';
import { POST } from '../route';

let db: FakeDashboardPool;

const spec = (metricId = 'resting_heart_rate', date: unknown = { kind: 'today' }) => ({ metricId, date });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  PUT(
    new Request(`http://localhost/api/dashboard/cards/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params(id)
  );
const del = (id: string, query = '?revision=1') =>
  DELETE(new Request(`http://localhost/api/dashboard/cards/${id}${query}`, { method: 'DELETE' }), params(id));

async function create(metricId?: string) {
  const res = await POST(
    new Request('http://localhost/api/dashboard/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'value', spec: spec(metricId) }),
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()).card as { id: string; revision: number };
}

beforeEach(() => {
  db = new FakeDashboardPool();
  holder.client = db;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PUT /api/dashboard/cards/:id', () => {
  it('replaces the settings, bumps the revision and answers 200', async () => {
    const { id } = await create();
    const res = await put(id, { spec: spec('heart_rate_variability', { kind: 'yesterday' }), revision: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    const { card } = await res.json();
    expect(card).toMatchObject({ id, revision: 2, spec: spec('heart_rate_variability', { kind: 'yesterday' }) });
  });

  it('validates against the stored type, which cannot change', async () => {
    const { id } = await create();
    const res = await put(id, { type: 'other', spec: spec(), revision: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be changed/);
  });

  it.each([
    ['a body that is not JSON', '{nope', /must be JSON/],
    ['an unknown top-level field', { spec: spec(), revision: 1, mode: 'live' }, /mode/],
    ['an unknown metric', { spec: spec('not_a_metric'), revision: 1 }, /no metric/],
    ['a bad date spec', { spec: spec('step_count', { kind: 'range', start: '2026-10-05', end: '2026-10-01' }), revision: 1 }, /on or before/],
    ['an unknown spec field', { spec: { ...spec(), color: 'red' }, revision: 1 }, /unknown field "color"/],
    ['a size the type does not offer', { spec: spec(), size: { w: 3, h: 1 }, revision: 1 }, /cannot be 3×1/],
    ['an oversized spec', { spec: spec('x'.repeat(3000)), revision: 1 }, /larger than/],
    ['a missing revision', { spec: spec() }, /revision/],
    ['a revision of zero', { spec: spec(), revision: 0 }, /revision/],
    ['a revision that is not whole', { spec: spec(), revision: 1.5 }, /revision/],
    ['a revision that is text', { spec: spec(), revision: 'one' }, /revision/],
  ])('answers 400 for %s and changes nothing', async (_n, body, message) => {
    const { id } = await create();
    const res = await put(id, body);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect((await res.json()).error).toMatch(message);
    expect(db.rows[0].revision).toBe(1);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await put('card-missing', { spec: spec(), revision: 1 });
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
  });

  it('answers 404 for a card of the other mode', async () => {
    vi.stubEnv('VITAL_DATA_MODE', 'live');
    const { id } = await create();
    vi.stubEnv('VITAL_DATA_MODE', '');
    expect((await put(id, { spec: spec(), revision: 1 })).status).toBe(404);
    expect((await del(id)).status).toBe(404);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].revision).toBe(1);
  });

  it('answers 409 with the current card on a stale revision', async () => {
    const { id } = await create();
    expect((await put(id, { spec: spec('vo2max'), revision: 1 })).status).toBe(200);
    const res = await put(id, { spec: spec('step_count'), revision: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/changed elsewhere/);
    expect(body.card).toMatchObject({ id, revision: 2, spec: spec('vo2max') });
  });
});

describe('DELETE /api/dashboard/cards/:id', () => {
  it('removes the card and answers 200 with its id', async () => {
    const { id } = await create();
    const res = await del(id, '?revision=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ id });
    expect(db.rows).toEqual([]);
  });

  it.each([
    ['no revision', ''],
    ['a revision of zero', '?revision=0'],
    ['a revision that is not whole', '?revision=1.5'],
    ['a revision that is text', '?revision=abc'],
  ])('answers 400 for %s and deletes nothing', async (_n, query) => {
    const { id } = await create();
    const res = await del(id, query);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/revision/);
    expect(db.rows).toHaveLength(1);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await del('card-missing')).status).toBe(404);
  });

  it('answers 409 on a stale revision and keeps the card', async () => {
    const { id } = await create();
    await put(id, { spec: spec('vo2max'), revision: 1 });
    const res = await del(id, '?revision=1');
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(db.rows).toHaveLength(1);
  });
});

describe('without a database', () => {
  it('PUT and DELETE answer 503 with the reason', async () => {
    holder.client = null;
    for (const res of [await put('card-x', { spec: spec(), revision: 1 }), await del('card-x')]) {
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store, private');
      expect((await res.json()).error).toMatch(/No Postgres database is configured/);
    }
  });
});
