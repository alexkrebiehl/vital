// ── /api/pipeline/status: the full report, or one part of it ────────────────

import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('@/lib/pipeline/status', () => ({
  resolvePipelineStatus: async () => {
    calls.push('full');
    return { full: true };
  },
  resolvePart: {
    sources: async () => (calls.push('sources'), { part: 'sources' }),
    dataset: async () => (calls.push('dataset'), { part: 'dataset' }),
    workouts: async () => (calls.push('workouts'), { part: 'workouts' }),
  },
}));

import { GET } from './route';

const get = (query = '') => GET(new Request(`http://localhost/api/pipeline/status${query}`));

describe('GET /api/pipeline/status', () => {
  it('answers the full report without a part, private and uncacheable', async () => {
    calls.length = 0;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ full: true });
    expect(calls).toEqual(['full']);
  });

  it.each(['sources', 'dataset', 'workouts'])('answers ?part=%s with that part alone', async part => {
    calls.length = 0;
    const res = await get(`?part=${part}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ part });
    expect(calls).toEqual([part]);
  });

  it('refuses an unknown part and checks nothing', async () => {
    calls.length = 0;
    const res = await get('?part=everything');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sources, dataset, workouts/);
    expect(calls).toEqual([]);
  });
});
