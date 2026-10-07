// ── GET /api/pipeline/quality: silenced findings are hidden and listed ───────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';
import type { DataQualityReport } from '@/lib/adapters/quality';
import { QUALITY_CHECK_LABEL } from '@/lib/adapters/quality';

const holder: { client: PoolLike | null; rows: { check_id: string; metric_id: string }[]; report: DataQualityReport | null } = {
  client: null,
  rows: [],
  report: null,
};

vi.mock('@/lib/db/pool', () => ({ getPool: () => holder.client, closePool: async () => {} }));
vi.mock('@/lib/adapters/runtime', () => ({
  readDataMode: () => 'live',
  LiveDataUnavailableError: class extends Error {},
  installDataset: async () => ({
    quality: { state: 'ready', value: holder.report, error: null, promise: Promise.resolve(holder.report) },
  }),
}));

import { GET } from './route';

const REPORT: DataQualityReport = {
  checks: [
    { id: 'stale', label: QUALITY_CHECK_LABEL.stale, outcome: 'flagged', summary: 'Nothing new for 40 hours.' },
    { id: 'missing-days', label: QUALITY_CHECK_LABEL['missing-days'], outcome: 'flagged', summary: '3 days missing.' },
  ],
  findings: [
    { check: 'stale', severity: 'problem', title: 'No new data is arriving', detail: 'Old.', metrics: [], ranges: [], affectedDays: 1, remedy: ['x'] },
    {
      check: 'missing-days',
      severity: 'warning',
      title: 'Days are missing from the export',
      detail: 'Gaps.',
      metrics: ['step_count'],
      ranges: [{ from: '2026-09-01', to: '2026-09-03', days: 3 }],
      affectedDays: 3,
      remedy: ['y'],
    },
  ],
};

beforeEach(() => {
  holder.report = REPORT;
  holder.rows = [];
  holder.client = {
    async query() {
      return { rows: holder.rows.map(r => ({ ...r })) };
    },
  };
});

describe('GET /api/pipeline/quality', () => {
  it('serves everything and an empty silenced list when nothing is silenced', async () => {
    const body = await (await GET()).json();
    expect(body.state).toBe('ready');
    expect(body.quality.findings).toHaveLength(2);
    expect(body.silenced).toEqual([]);
  });

  it('hides a silenced finding and lists it under silenced', async () => {
    holder.rows = [{ check_id: 'missing-days', metric_id: '' }];
    const body = await (await GET()).json();
    expect(body.quality.findings.map((f: { check: string }) => f.check)).toEqual(['stale']);
    expect(body.silenced).toEqual([
      expect.objectContaining({ checkId: 'missing-days', found: true, firstDay: '2026-09-01', lastDay: '2026-09-03' }),
    ]);
  });

  it('serves the unfiltered report when there is no database: nothing can be silenced', async () => {
    holder.client = null;
    const body = await (await GET()).json();
    expect(body.quality.findings).toHaveLength(2);
    expect(body.silenced).toEqual([]);
  });

  it('serves the unfiltered report, not an error, when the silenced list cannot be read', async () => {
    holder.client = { query: async () => { throw new Error('connection refused'); } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).quality.findings).toHaveLength(2);
  });
});
