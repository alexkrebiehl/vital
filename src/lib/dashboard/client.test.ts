import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DashboardRequestError,
  createCardRequest,
  deleteCardRequest,
  fetchDashboard,
  reorderCardsRequest,
  replaceCardRequest,
} from './client';

const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const spec = { metricId: 'resting_heart_rate', date: { kind: 'today' } };
const lastCall = () => fetchMock.mock.calls[0] as [string, RequestInit];

describe('dashboard client', () => {
  it('fetchDashboard GETs the collection without caching', async () => {
    const body = { mode: 'demo', cards: [], limits: { maxCards: 48 } };
    reply(body);
    expect(await fetchDashboard()).toEqual(body);
    const [url, init] = lastCall();
    expect(url).toBe('/api/dashboard/cards');
    expect(init.cache).toBe('no-store');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('createCardRequest POSTs the input and returns the card', async () => {
    reply({ card: { id: 'card-1' } }, 201);
    const card = await createCardRequest({ type: 'value', spec });
    expect(card).toEqual({ id: 'card-1' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/dashboard/cards');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'value', spec });
  });

  it('replaceCardRequest PUTs the spec with the revision to the card', async () => {
    reply({ card: { id: 'card/1', revision: 3 } });
    await replaceCardRequest('card/1', { spec }, 2);
    const [url, init] = lastCall();
    expect(url).toBe('/api/dashboard/cards/card%2F1');
    expect(init.method).toBe('PUT');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual({ spec, revision: 2 });
  });

  it('deleteCardRequest DELETEs with the revision in the query', async () => {
    reply({ id: 'card-1' });
    await deleteCardRequest('card-1', 4);
    const [url, init] = lastCall();
    expect(url).toBe('/api/dashboard/cards/card-1?revision=4');
    expect(init.method).toBe('DELETE');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBeUndefined();
  });

  it('reorderCardsRequest PUTs the order to the collection and returns the cards', async () => {
    reply({ cards: [{ id: 'b' }, { id: 'a' }] });
    expect(await reorderCardsRequest(['b', 'a'])).toEqual([{ id: 'b' }, { id: 'a' }]);
    const [url, init] = lastCall();
    expect(url).toBe('/api/dashboard/cards');
    expect(init.method).toBe('PUT');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual({ order: ['b', 'a'] });
  });

  it("carries the route's message and status on the error", async () => {
    reply({ error: 'There is no metric "x".' }, 400);
    const err = await createCardRequest({ type: 'value', spec }).catch(e => e);
    expect(err).toBeInstanceOf(DashboardRequestError);
    expect(err.message).toBe('There is no metric "x".');
    expect(err.status).toBe(400);
    expect(err.current).toBeUndefined();
  });

  it('exposes the current card of a 409', async () => {
    const current = { id: 'card-1', revision: 5 };
    reply({ error: 'changed elsewhere', card: current }, 409);
    const err = await replaceCardRequest('card-1', { spec }, 1).catch(e => e);
    expect(err.status).toBe(409);
    expect(err.current).toEqual(current);
  });

  it('falls back to a plain sentence when the body has no message', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    const err = await fetchDashboard().catch(e => e);
    expect(err.message).toBe('The request failed (HTTP 502).');
  });
});
