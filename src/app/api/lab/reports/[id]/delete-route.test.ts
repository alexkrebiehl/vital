// Deleting a lab report: the LAST one going is a deliberate removal of the source,
// so the request writes the removal marker. Deleting one of several does not.
// The pool is replaced by a small in-memory stand-in; nothing real is touched.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';

const SHA = 'a'.repeat(64);
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

interface Held {
  client: (PoolLike & { reports: Set<string>; marked: string[]; markerError: Error | null }) | null;
}
const held = vi.hoisted((): Held => ({ client: null }));

vi.mock('@/lib/db/pool', () => ({ getPool: () => held.client, closePool: async () => {} }));
vi.mock('@/lib/sources/purge', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/sources/purge')>()),
  reconcileQuietly: async () => null,
}));

import { DELETE } from './route';

function pool(ids: string[]) {
  const reports = new Set(ids);
  const self = {
    reports,
    marked: [] as string[],
    markerError: null as Error | null,
    async query(text: string, params: unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('INSERT INTO data_sources_seen (source_id, removed_at)')) {
        if (self.markerError) throw self.markerError;
        self.marked.push(...(params[0] as string[]));
        return { rows: [] };
      }
      if (sql.includes('count(*)') && sql.includes('FROM lab_reports')) return { rows: [{ n: reports.size }] };
      if (sql.startsWith('DELETE FROM lab_reports')) {
        return { rows: reports.delete(String(params[0])) ? [{ id: params[0] }] : [] };
      }
      if (sql.includes('FROM lab_reports') && sql.includes('source_sha256 = $1')) return { rows: [] };
      if (sql.includes('FROM lab_reports') && sql.includes('WHERE id = $1')) {
        return reports.has(String(params[0])) ? { rows: [{ id: params[0], source_sha256: SHA }] } : { rows: [] };
      }
      return { rows: [] };
    },
  };
  return self;
}

const call = (id: string) =>
  DELETE(new Request(`http://app.test/api/lab/reports/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv('VITAL_LAB_DIR', '/nonexistent/vital-test-lab');
  held.client = null;
});

describe('DELETE /api/lab/reports/[id] and the removal marker', () => {
  it('marks the lab source removed when the last report is deleted', async () => {
    held.client = pool([ID]);
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(held.client.marked).toEqual(['lab']);
  });

  it('does not mark it while other reports remain', async () => {
    held.client = pool([ID, OTHER]);
    expect((await call(ID)).status).toBe(200);
    expect(held.client.marked).toEqual([]);
  });

  it('does not mark anything for a report that does not exist', async () => {
    held.client = pool([]);
    expect((await call(ID)).status).toBe(404);
    expect(held.client.marked).toEqual([]);
  });

  it('fails the request when the marker cannot be written', async () => {
    held.client = pool([ID]);
    held.client.markerError = new Error('connection reset');
    const res = await call(ID);
    expect(res.status).toBe(500);
    expect(held.client.marked).toEqual([]);
  });
});
