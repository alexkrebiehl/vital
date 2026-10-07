import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';

const holder: { client: PoolLike | null } = { client: null };
vi.mock('@/lib/db/pool', () => ({ getPool: () => holder.client, closePool: async () => {} }));

import { GET } from './delete-impact/route';

describe('GET /api/lab/delete-impact', () => {
  beforeEach(() => {
    holder.client = null;
  });

  it('answers 503 without a database', async () => {
    expect((await GET()).status).toBe(503);
  });

  it('reports the report count and the conversations a delete of the last report would remove', async () => {
    holder.client = { query: async () => ({ rows: [{ reports: 1, conversations: 2 }] }) };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: 1, lastReport: true, conversations: 2 });
  });

  it('does not forward a database error', async () => {
    holder.client = {
      query: async () => {
        throw new Error('select secret from x');
      },
    };
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
