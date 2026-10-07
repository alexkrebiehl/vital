import { describe, expect, it } from 'vitest';
import type { OuraConfig } from './config';
import { MAX_PAGES, OuraError, fetchHeartRate, ouraGetAll, type OuraClientDeps } from './client';

const config: OuraConfig = {
  clientId: 'sample-client',
  clientSecret: 'sample-secret',
  redirectUri: 'http://localhost:8080/cb',
  loginClientId: null,
  scopes: ['daily'],
  apiUrl: 'https://api.example.test',
  cacheTtlSeconds: 300,
  heartrateLookbackDays: 30,
  heartrateChunkDays: 7,
  preferredFor: [],
};

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string } | Error;

function setup(replies: Reply[] | ((url: URL, auth: string) => Reply), opts: { timeoutMs?: number; now?: () => number } = {}) {
  const calls: { url: URL; auth: string }[] = [];
  const sleeps: number[] = [];
  const tokenCalls: { rejectedToken?: string }[] = [];
  let tokenN = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ url: u, auth });
    const reply = typeof replies === 'function' ? replies(u, auth) : replies.shift();
    if (!reply) throw new Error('no reply queued');
    if (reply instanceof Error) throw reply;
    return new Response(reply.raw ?? JSON.stringify(reply.body ?? { data: [] }), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as unknown as typeof fetch;
  const deps: OuraClientDeps = {
    config,
    getToken: async req => {
      tokenCalls.push(req ?? {});
      tokenN += 1;
      return `sample-token-${tokenN}`;
    },
    http: { fetchImpl, timeoutMs: opts.timeoutMs, now: opts.now },
    sleep: async ms => {
      sleeps.push(ms);
    },
  };
  return { deps, calls, sleeps, tokenCalls };
}

describe('ouraGetAll', () => {
  it('builds the URL and sends a bearer header', async () => {
    const { deps, calls } = setup([{ body: { data: [{ id: 'a' }], next_token: null } }]);
    const out = await ouraGetAll('daily_activity', { start_date: '2026-09-01', end_date: '2026-09-30', skip: undefined }, deps);
    expect(out).toEqual([{ id: 'a' }]);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe('https://api.example.test/v2/usercollection/daily_activity');
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ start_date: '2026-09-01', end_date: '2026-09-30' });
    expect(calls[0].auth).toBe('Bearer sample-token-1');
  });

  it('joins pages by following next_token', async () => {
    const { deps, calls } = setup([
      { body: { data: [{ n: 1 }, { n: 2 }], next_token: 'tok-a' } },
      { body: { data: [{ n: 3 }], next_token: 'tok-b' } },
      { body: { data: [{ n: 4 }], next_token: null } },
    ]);
    const out = await ouraGetAll<{ n: number }>('sleep', {}, deps);
    expect(out.map(r => r.n)).toEqual([1, 2, 3, 4]);
    expect(calls.map(c => c.url.searchParams.get('next_token'))).toEqual([null, 'tok-a', 'tok-b']);
  });

  it('stops with too_many_pages after the safety cap', async () => {
    const { deps, calls } = setup(() => ({ body: { data: [], next_token: 'again' } }));
    const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
    expect(err).toBeInstanceOf(OuraError);
    expect(err.kind).toBe('too_many_pages');
    expect(calls).toHaveLength(MAX_PAGES);
  });

  describe('429', () => {
    it('waits Retry-After seconds, then retries once', async () => {
      const { deps, sleeps, calls } = setup([
        { status: 429, headers: { 'Retry-After': '2' } },
        { body: { data: [{ ok: true }] } },
      ]);
      expect(await ouraGetAll('sleep', {}, deps)).toEqual([{ ok: true }]);
      expect(sleeps).toEqual([2000]);
      expect(calls).toHaveLength(2);
    });

    it('gives rate_limited when the retry is also limited', async () => {
      const { deps, calls } = setup([
        { status: 429, headers: { 'Retry-After': '1' } },
        { status: 429, headers: { 'Retry-After': '1' } },
      ]);
      const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
      expect(err.kind).toBe('rate_limited');
      expect(calls).toHaveLength(2);
    });

    it('does not wait when Retry-After is missing or not seconds', async () => {
      for (const headers of [undefined, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }]) {
        const { deps, sleeps, calls } = setup([{ status: 429, headers }]);
        const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
        expect(err.kind).toBe('rate_limited');
        expect(sleeps).toEqual([]);
        expect(calls).toHaveLength(1);
      }
    });

    it('caps the wait at 60 s and refuses a wait that does not fit the 20 s budget', async () => {
      const { deps, sleeps } = setup([{ status: 429, headers: { 'Retry-After': '300' } }]);
      const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
      expect(err.kind).toBe('rate_limited');
      expect(sleeps).toEqual([]);

      // With a budget larger than the cap, the wait is the capped 60 s.
      const roomy = setup([{ status: 429, headers: { 'Retry-After': '300' } }, { body: { data: [] } }], { timeoutMs: 120_000 });
      await ouraGetAll('sleep', {}, roomy.deps);
      expect(roomy.sleeps).toEqual([60_000]);
    });

    it('counts the time already spent against the budget', async () => {
      let t = 0;
      const { deps, sleeps } = setup([{ status: 429, headers: { 'Retry-After': '10' } }], { now: () => t });
      const original = deps.http!.fetchImpl!;
      deps.http!.fetchImpl = (async (...args: Parameters<typeof fetch>) => {
        t += 15_000; // the first attempt took 15 s; 10 s more would exceed 20 s
        return original(...args);
      }) as typeof fetch;
      const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
      expect(err.kind).toBe('rate_limited');
      expect(sleeps).toEqual([]);
    });
  });

  describe('401', () => {
    it('forces exactly one refresh, retries with the new token, and succeeds', async () => {
      const { deps, tokenCalls, calls } = setup([{ status: 401 }, { body: { data: [{ ok: 1 }] } }]);
      expect(await ouraGetAll('sleep', {}, deps)).toEqual([{ ok: 1 }]);
      expect(tokenCalls).toEqual([{}, { rejectedToken: 'sample-token-1' }]);
      expect(calls.map(c => c.auth)).toEqual(['Bearer sample-token-1', 'Bearer sample-token-2']);
    });

    it('reports needs_reconnect when the refreshed token is refused too, with no second refresh', async () => {
      const { deps, tokenCalls } = setup([{ status: 401 }, { status: 401 }]);
      const err = await ouraGetAll('sleep', {}, deps).catch(e => e);
      expect(err.kind).toBe('needs_reconnect');
      expect(tokenCalls).toHaveLength(2);
    });
  });

  it('treats a 401 that names a missing scope as forbidden, without a refresh', async () => {
    const { deps, tokenCalls } = setup([
      { status: 401, body: { detail: 'Token is not authorized access heart_health scope.' } },
    ]);
    const err = await ouraGetAll('vO2_max', {}, deps).catch(e => e);
    expect(err.kind).toBe('forbidden');
    expect(tokenCalls).toHaveLength(1);
  });

  it('maps statuses to kinds', async () => {
    const cases: [number, string][] = [
      [403, 'forbidden'],
      [400, 'bad_request'],
      [422, 'bad_request'],
      [500, 'http_error'],
    ];
    for (const [status, kind] of cases) {
      const err = await ouraGetAll('sleep', {}, setup([{ status }]).deps).catch(e => e);
      expect(err.kind).toBe(kind);
      expect(err.httpStatus).toBe(status);
    }
    expect((await ouraGetAll('sleep', {}, setup([{ status: 403 }]).deps).catch(e => e)).message).toMatch(/scope.*membership/);
  });

  it('maps network errors, timeouts and bad bodies', async () => {
    expect((await ouraGetAll('sleep', {}, setup([new Error('boom')]).deps).catch(e => e)).kind).toBe('network_error');
    expect((await ouraGetAll('sleep', {}, setup([{ raw: 'not json' }]).deps).catch(e => e)).kind).toBe('invalid_payload');
    expect((await ouraGetAll('sleep', {}, setup([{ body: { nope: 1 } }]).deps).catch(e => e)).kind).toBe('invalid_payload');

    const hang = setup([]);
    hang.deps.http!.fetchImpl = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    hang.deps.http!.timeoutMs = 5;
    expect((await ouraGetAll('sleep', {}, hang.deps).catch(e => e)).kind).toBe('timeout');
  });

  it('never puts the Authorization header, a token or the URL in an error message', async () => {
    const replies: Reply[][] = [
      [{ status: 403 }],
      [{ status: 500 }],
      [{ status: 400 }],
      [new Error('failed https://api.example.test Bearer sample-token-1')],
      [{ status: 401 }, { status: 401 }],
      [{ status: 429 }],
      [{ raw: 'nope' }],
    ];
    for (const r of replies) {
      const err = await ouraGetAll('sleep', { start_date: '2026-09-01' }, setup(r).deps).catch(e => e);
      expect(err).toBeInstanceOf(OuraError);
      for (const bad of ['Bearer', 'sample-token', 'Authorization', 'api.example.test', 'start_date']) {
        expect(err.message).not.toContain(bad);
      }
    }
  });
});

describe('fetchHeartRate', () => {
  const sample = (ts: string, bpm = 60) => ({ bpm, source: 'rest', timestamp: ts });

  it('requests one window per chunk, covering the span with no gap', async () => {
    const { deps, calls } = setup(() => ({ body: { data: [] } }));
    await fetchHeartRate({ start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-16T00:00:00Z') }, deps);
    expect(calls).toHaveLength(3);
    const windows = calls.map(c => [c.url.searchParams.get('start_datetime'), c.url.searchParams.get('end_datetime')]);
    expect(windows).toEqual([
      ['2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z'],
      ['2026-09-08T00:00:00.000Z', '2026-09-15T00:00:00.000Z'],
      ['2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z'],
    ]);
    expect(calls[0].url.pathname).toBe('/v2/usercollection/heartrate');
  });

  it('uses a 30-day lookback in five requests at the default chunk size', async () => {
    const { deps, calls } = setup(() => ({ body: { data: [] } }));
    await fetchHeartRate({ start: new Date('2026-09-04T00:00:00Z'), end: new Date('2026-10-04T00:00:00Z') }, deps);
    expect(calls).toHaveLength(5);
  });

  it('honours a different chunk size', async () => {
    const { deps, calls } = setup(() => ({ body: { data: [] } }));
    deps.config = { ...config, heartrateChunkDays: 10 };
    await fetchHeartRate({ start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-21T00:00:00Z') }, deps);
    expect(calls).toHaveLength(2);
  });

  it('follows next_token inside a chunk and keeps a boundary sample once', async () => {
    let n = 0;
    const { deps, calls } = setup(() => {
      n += 1;
      if (n === 1) return { body: { data: [sample('2026-09-02T00:00:00Z')], next_token: 't' } };
      if (n === 2) return { body: { data: [sample('2026-09-08T00:00:00Z')], next_token: null } };
      return { body: { data: [sample('2026-09-08T00:00:00Z'), sample('2026-09-09T00:00:00Z')] } };
    });
    const out = await fetchHeartRate({ start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-10T00:00:00Z') }, deps);
    expect(out.map(s => s.timestamp)).toEqual(['2026-09-02T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z']);
    expect(calls).toHaveLength(3);
    expect(calls[1].url.searchParams.get('next_token')).toBe('t');
  });

  it('returns nothing, with no request, for an empty or reversed window', async () => {
    const { deps, calls } = setup([]);
    const t = new Date('2026-09-01T00:00:00Z');
    expect(await fetchHeartRate({ start: t, end: t }, deps)).toEqual([]);
    expect(await fetchHeartRate({ start: t, end: new Date(t.getTime() - 1) }, deps)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
