// ── Route-level tests for /api/medications, with the adapter INJECTED ───────
//
// The route is driven through its real GET handler; the only thing replaced is
// the adapter's cached read, so the request parsing, window defaults, status
// codes, cache headers and honest-empty/failure payloads under test are the ones
// production runs. No upstream request is made and no credential is read.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HaeError } from '@/lib/adapters/hae';
import type { MedicationReadResult } from '@/lib/adapters/medications';

const holder: { result: MedicationReadResult | null; error: Error | null; calls: unknown[] } = {
  result: null,
  error: null,
  calls: [],
};

vi.mock('@/lib/adapters/medications', () => ({
  loadMedications: async (window: unknown) => {
    holder.calls.push(window);
    if (holder.error) throw holder.error;
    return holder.result;
  },
}));

import { GET as medicationsRoute } from './route';
import { MEDICATIONS_SOURCE, resolveWindow } from '@/lib/medications/window';

function record(id: string, dayKey: string | null): MedicationReadResult['records'][number] {
  return {
    id,
    displayText: 'Carvedilol 6.25mg Oral tablet',
    groupingKey: 'Carvedilol',
    dosage: 1,
    status: 'Taken',
    scheduledDate: dayKey === null ? null : `${dayKey}T03:00:00.000Z`,
    dayKey,
    start: null,
    end: null,
    isArchived: false,
    codings: [],
  };
}

beforeEach(() => {
  holder.result = null;
  holder.error = null;
  holder.calls = [];
});

describe('GET /api/medications', () => {
  it('returns the read model with the window echoed and a no-store header', async () => {
    holder.result = {
      records: [record('a1', '2026-09-28'), record('a2', null)],
      window: { from: '2026-08-30', to: '2026-09-29' },
      covered: { from: '2026-09-28T03:00:00.000Z', to: '2026-09-28T03:00:00.000Z' },
    };

    const response = await medicationsRoute(
      new Request('http://test/api/medications?from=2026-08-30&to=2026-09-29')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.available).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.source).toBe(MEDICATIONS_SOURCE);
    expect(body.window).toEqual({ from: '2026-08-30', to: '2026-09-29' });
    expect(body.covered).toEqual({ from: '2026-09-28T03:00:00.000Z', to: '2026-09-28T03:00:00.000Z' });
    expect((body.records as unknown[]).length).toBe(2);
  });

  it('passes the requested bounds through to the adapter', async () => {
    holder.result = { records: [], window: { from: '2026-08-30', to: '2026-09-29' }, covered: null };
    await medicationsRoute(new Request('http://test/api/medications?from=2026-08-30&to=2026-09-29'));
    expect(holder.calls).toEqual([{ from: '2026-08-30', to: '2026-09-29' }]);
  });

  it('an empty window is an honest empty: 200, zero records, covered null, no error', async () => {
    holder.result = { records: [], window: { from: '2026-08-30', to: '2026-09-29' }, covered: null };
    const response = await medicationsRoute(new Request('http://test/api/medications'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.available).toBe(true);
    expect(body.records).toEqual([]);
    expect(body.covered).toBeNull();
  });

  it('reports a configured-source failure honestly rather than fabricating zeroes', async () => {
    holder.error = new HaeError('The Health Auto Export API could not be reached.', 'network_error');
    const response = await medicationsRoute(
      new Request('http://test/api/medications?from=2026-08-30&to=2026-09-29')
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.available).toBe(false);
    expect(body.reason).toContain('could not be reached');
    expect(body.records).toEqual([]);
    expect(body.covered).toBeNull();
  });

  it('never discloses a credential or upstream host in the payload', async () => {
    holder.error = new HaeError('The Health Auto Export API answered HTTP 500 for /api/medications.', 'http_error', 500);
    const response = await medicationsRoute(new Request('http://test/api/medications'));
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/api-key|Bearer|HAE_API_KEY|https?:\/\//);
  });

  it('rejects a malformed window bound with 400', async () => {
    const response = await medicationsRoute(new Request('http://test/api/medications?from=September'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('YYYY-MM-DD');
  });

  it('rejects an end that does not fall after its start with 400', async () => {
    const response = await medicationsRoute(
      new Request('http://test/api/medications?from=2026-09-30&to=2026-09-01')
    );
    expect(response.status).toBe(400);
    expect(holder.calls).toEqual([]);
  });

  it('defaults the window to the last 30 days when no bounds are given', () => {
    const resolved = resolveWindow(new URLSearchParams(), new Date('2026-09-28T17:00:00.000Z'));
    expect(resolved).toEqual({ from: '2026-08-30', to: '2026-09-29' });
  });
});
