import { describe, expect, it } from 'vitest';
import type { CardRecord } from '@/lib/dashboard/types';
import { DashboardRequestError } from '@/lib/dashboard/client';
import {
  applyOrder, dashboardReducer, failedWrite, focusAfterRemove, initialDashboardState, writeFailureNotice, type DashboardState,
} from './dashboard-state';

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

describe('dashboardReducer writes', () => {
  const ready = (...ids: string[]): DashboardState => ({
    ...initialDashboardState, status: 'ready', cards: ids.map(card),
  });

  it('added appends the new card at the end', () => {
    const next = dashboardReducer(ready('a', 'b'), { type: 'added', card: card('c') });
    expect(next.cards.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('edited replaces the card in place, keeping its position', () => {
    const changed = { ...card('b'), revision: 2, spec: { metricId: 'step_count', date: { kind: 'yesterday' as const } } };
    const next = dashboardReducer(ready('a', 'b', 'c'), { type: 'edited', card: changed });
    expect(next.cards.map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(next.cards[1]).toBe(changed);
  });

  it('edited with a card that is not on screen changes nothing', () => {
    const state = ready('a');
    expect(dashboardReducer(state, { type: 'edited', card: card('zz') }).cards).toEqual(state.cards);
  });

  it('removed drops the card and keeps the others in order', () => {
    const next = dashboardReducer(ready('a', 'b', 'c'), { type: 'removed', id: 'b' });
    expect(next.cards.map(c => c.id)).toEqual(['a', 'c']);
    expect(next.status).toBe('ready');
  });

  it('removing the last card leaves a ready, empty dashboard', () => {
    const next = dashboardReducer(ready('a'), { type: 'removed', id: 'a' });
    expect(next).toMatchObject({ status: 'ready', cards: [] });
  });

  it('a failed write sets the notice and keeps the cards; a reload then keeps the notice', () => {
    const failed = dashboardReducer(ready('a'), { type: 'write-failed', message: 'Not saved.' });
    expect(failed).toMatchObject({ status: 'ready', notice: 'Not saved.' });
    const reloading = dashboardReducer(failed, { type: 'reload' });
    expect(dashboardReducer(reloading, { type: 'loaded', cards: [card('a'), card('b')] })).toMatchObject({
      notice: 'Not saved.',
      cards: [{ id: 'a' }, { id: 'b' }],
    });
  });

  it('dismissing clears the notice', () => {
    const noticed = dashboardReducer(ready('a'), { type: 'write-failed', message: 'x' });
    expect(dashboardReducer(noticed, { type: 'dismiss-notice' }).notice).toBeNull();
  });
});

describe('writeFailureNotice', () => {
  it('names the action and gives the server’s sentence', () => {
    expect(writeFailureNotice('add', new DashboardRequestError('The database is down.', 500))).toBe(
      'The card was not added: The database is down.'
    );
    expect(writeFailureNotice('edit', new Error('offline'))).toBe('The card was not saved: offline');
    expect(writeFailureNotice('remove', new DashboardRequestError('Boom.', 500))).toBe(
      'The card was not removed: Boom.'
    );
  });

  it('a stale revision says the dashboard was reloaded', () => {
    expect(writeFailureNotice('remove', new DashboardRequestError('stale', 409))).toBe(
      'This card was changed elsewhere; the dashboard was reloaded and nothing was removed.'
    );
    expect(writeFailureNotice('edit', new DashboardRequestError('stale', 409))).toBe(
      'This card was changed elsewhere; the dashboard was reloaded and nothing was overwritten.'
    );
  });

  it('a non-error value still gets a sentence', () => {
    expect(writeFailureNotice('add', 'x')).toBe('The card was not added.');
  });
});

describe('focusAfterRemove', () => {
  it('prefers the next card, then the previous, then the Add card button', () => {
    expect(focusAfterRemove(['a', 'b', 'c'], 'b')).toEqual({ kind: 'card', id: 'c' });
    expect(focusAfterRemove(['a', 'b', 'c'], 'c')).toEqual({ kind: 'card', id: 'b' });
    expect(focusAfterRemove(['a'], 'a')).toEqual({ kind: 'add' });
    expect(focusAfterRemove(['a'], 'zz')).toEqual({ kind: 'add' });
  });
});

describe('failedWrite', () => {
  const stale = (current?: CardRecord) => Object.assign(new DashboardRequestError('Changed.', 409), { current });

  it('a 400 stays in the dialog with the server’s sentence', () => {
    expect(failedWrite('add', new DashboardRequestError('Choose a metric.', 400))).toEqual({
      ok: false, message: 'Choose a metric.', keepOpen: true,
    });
  });

  it('a 409 on save stays in the dialog and carries the current card', () => {
    expect(failedWrite('edit', stale(card('a')))).toEqual({
      ok: false, message: 'Changed.', current: card('a'), keepOpen: true,
    });
  });

  it('a 409 on add (the card limit) stays in the dialog with the server’s sentence', () => {
    expect(failedWrite('add', stale())).toMatchObject({ message: 'Changed.', keepOpen: true });
  });

  it('anything else closes the dialog with the page notice', () => {
    expect(failedWrite('add', new DashboardRequestError('The database is down.', 500))).toEqual({
      ok: false, message: 'The card was not added: The database is down.', keepOpen: false,
    });
    expect(failedWrite('edit', stale())).toMatchObject({ keepOpen: false });
  });
});

describe('reorder', () => {
  const ready = (...ids: string[]): DashboardState => ({
    ...initialDashboardState, status: 'ready', cards: ids.map(card),
  });

  it('reordered puts the cards in the new order at once (optimistic)', () => {
    const next = dashboardReducer(ready('a', 'b', 'c'), { type: 'reordered', ids: ['c', 'a', 'b'] });
    expect(next.cards.map(c => c.id)).toEqual(['c', 'a', 'b']);
    expect(next.status).toBe('ready');
  });

  it('after a successful write the server answer keeps that order', () => {
    const moved = dashboardReducer(ready('a', 'b', 'c'), { type: 'reordered', ids: ['b', 'c', 'a'] });
    const saved = dashboardReducer(moved, { type: 'loaded', cards: [card('b'), card('c'), card('a')] });
    expect(saved.cards.map(c => c.id)).toEqual(['b', 'c', 'a']);
    expect(saved.notice).toBeNull();
  });

  it('after a failed write the notice shows and the reload restores the server order', () => {
    const moved = dashboardReducer(ready('a', 'b', 'c'), { type: 'reordered', ids: ['c', 'b', 'a'] });
    const failed = dashboardReducer(moved, { type: 'write-failed', message: writeFailureNotice('reorder', new Error('Boom.')) });
    expect(failed.notice).toBe('The cards were not moved: Boom.');
    const restored = dashboardReducer(dashboardReducer(failed, { type: 'reload' }), {
      type: 'loaded',
      cards: [card('a'), card('b'), card('c')],
    });
    expect(restored.cards.map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(restored.notice).toBe('The cards were not moved: Boom.');
  });

  it('applyOrder ignores unknown ids and keeps unnamed cards after the named ones', () => {
    const cards = ['a', 'b', 'c'].map(card);
    expect(applyOrder(cards, ['c', 'zz', 'a']).map(c => c.id)).toEqual(['c', 'a', 'b']);
  });
});
