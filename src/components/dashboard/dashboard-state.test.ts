import { describe, expect, it } from 'vitest';
import type { CardRecord } from '@/lib/dashboard/types';
import { dashboardReducer, initialDashboardState, type DashboardState } from './dashboard-state';

const card = (id: string): CardRecord => ({
  id,
  type: 'value',
  spec: { metricId: 'step_count', date: { kind: 'today' } },
  schemaVersion: 1,
  layout: { w: 1, h: 1, order: 0 },
  revision: 1,
  createdAt: '2026-03-10T00:00:00.000Z',
  updatedAt: '2026-03-10T00:00:00.000Z',
  status: 'ok',
});

describe('dashboardReducer', () => {
  it('starts loading, with no cards, no error and no notice', () => {
    expect(initialDashboardState).toEqual({ status: 'loading', cards: [], error: null, notice: null });
  });

  it('loaded → ready with the cards, clearing any error', () => {
    const failed: DashboardState = { ...initialDashboardState, status: 'error', error: { message: 'x', httpStatus: 500 } };
    const next = dashboardReducer(failed, { type: 'loaded', cards: [card('a'), card('b')] });
    expect(next).toMatchObject({ status: 'ready', error: null });
    expect(next.cards.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('failed → error with the message and HTTP status, and no cards', () => {
    const ready = dashboardReducer(initialDashboardState, { type: 'loaded', cards: [card('a')] });
    const next = dashboardReducer(ready, { type: 'failed', message: 'The database is down.', httpStatus: 503 });
    expect(next).toMatchObject({ status: 'error', cards: [], error: { message: 'The database is down.', httpStatus: 503 } });
  });

  it('failed with no HTTP status (the network) keeps it null', () => {
    const next = dashboardReducer(initialDashboardState, { type: 'failed', message: 'offline', httpStatus: null });
    expect(next.error).toEqual({ message: 'offline', httpStatus: null });
  });

  it('reload from an error goes back to loading and drops the error', () => {
    const failed = dashboardReducer(initialDashboardState, { type: 'failed', message: 'x', httpStatus: 500 });
    expect(dashboardReducer(failed, { type: 'reload' })).toMatchObject({ status: 'loading', error: null, cards: [] });
  });

  it('reload from ready keeps the cards on screen while the next answer arrives', () => {
    const ready = dashboardReducer(initialDashboardState, { type: 'loaded', cards: [card('a')] });
    const next = dashboardReducer(ready, { type: 'reload' });
    expect(next.status).toBe('ready');
    expect(next.cards).toHaveLength(1);
  });

  it('a notice survives a load, so a failed write can say so and reload', () => {
    const noticed: DashboardState = { ...initialDashboardState, notice: 'That change was not saved.' };
    expect(dashboardReducer(noticed, { type: 'loaded', cards: [] }).notice).toBe('That change was not saved.');
  });
});
