// ── Route tests for silencing data-quality findings, with an INJECTED pool ───

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';

const holder: { client: PoolLike | null; rows: { check_id: string; metric_id: string }[] } = { client: null, rows: [] };

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.client,
  closePool: async () => {},
}));

import { POST, DELETE } from './route';

/** A pool that holds the quality_silenced table in memory. */
function fakePool(): PoolLike {
  return {
    async query(text: string, params: unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('INSERT INTO quality_silenced')) {
        if (!holder.rows.some(r => r.check_id === params[0] && r.metric_id === params[1])) {
          holder.rows.push({ check_id: String(params[0]), metric_id: String(params[1]) });
        }
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM quality_silenced')) {
        holder.rows = holder.rows.filter(r => !(r.check_id === params[0] && r.metric_id === params[1]));
        return { rows: [] };
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  };
}

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/pipeline/quality/silence', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  holder.rows = [];
  holder.client = fakePool();
});

describe('POST /api/pipeline/quality/silence', () => {
  it('silences a finding and answers 200, private and uncacheable', async () => {
    const res = await POST(req('POST', { checkId: 'late-start', metricId: 'dietary_energy' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ checkId: 'late-start', metricId: 'dietary_energy' });
    expect(holder.rows).toEqual([{ check_id: 'late-start', metric_id: 'dietary_energy' }]);
  });

  it('stores a finding that is not per metric under the empty metric id', async () => {
    expect((await POST(req('POST', { checkId: 'stale' }))).status).toBe(200);
    expect(holder.rows).toEqual([{ check_id: 'stale', metric_id: '' }]);
  });

  it('is idempotent: silencing twice answers 200 and keeps one row', async () => {
    expect((await POST(req('POST', { checkId: 'stale' }))).status).toBe(200);
    expect((await POST(req('POST', { checkId: 'stale' }))).status).toBe(200);
    expect(holder.rows).toHaveLength(1);
  });

  it.each([
    ['an unknown check', { checkId: 'nope' }],
    ['an unregistered metric', { checkId: 'late-start', metricId: 'not_a_metric' }],
    ['a metric on a check that is not per metric', { checkId: 'stale', metricId: 'step_count' }],
    ['a missing check', {}],
    ['an unknown field', { checkId: 'stale', day: '2026-10-01' }],
  ])('answers 400 for %s and writes nothing', async (_n, body) => {
    const res = await POST(req('POST', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\S/);
    expect(holder.rows).toEqual([]);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await POST(req('POST', '{nope'))).status).toBe(400);
  });

  it('answers 503 with the reason when no database is configured', async () => {
    holder.client = null;
    const res = await POST(req('POST', { checkId: 'stale' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/No Postgres database is configured/);
  });

  it('still answers 400 for a bad id when no database is configured', async () => {
    holder.client = null;
    expect((await POST(req('POST', { checkId: 'nope' }))).status).toBe(400);
  });

  it('answers 500 when the database fails', async () => {
    holder.client = { query: async () => { throw new Error('connection refused'); } };
    const res = await POST(req('POST', { checkId: 'stale' }));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/pipeline/quality/silence', () => {
  it('restores a silenced finding', async () => {
    await POST(req('POST', { checkId: 'stale' }));
    await POST(req('POST', { checkId: 'late-start', metricId: 'step_count' }));
    const res = await DELETE(req('DELETE', { checkId: 'stale' }));
    expect(res.status).toBe(200);
    expect(holder.rows).toEqual([{ check_id: 'late-start', metric_id: 'step_count' }]);
  });

  it('is idempotent: restoring what is not silenced answers 200', async () => {
    expect((await DELETE(req('DELETE', { checkId: 'stale' }))).status).toBe(200);
    expect((await DELETE(req('DELETE', { checkId: 'stale' }))).status).toBe(200);
  });

  it('answers 400 for an invalid id and 503 without a database', async () => {
    expect((await DELETE(req('DELETE', { checkId: 'nope' }))).status).toBe(400);
    holder.client = null;
    expect((await DELETE(req('DELETE', { checkId: 'stale' }))).status).toBe(503);
  });
});
