// ── Route tests: the stored Hevy connection ──────────────────────────────────
//
// The real handlers run. Replaced: the Postgres pool (an in-memory table) and the
// network (a stub fetch that plays the Hevy API). Real: the AES-GCM helper, the
// probe, the caches, the training store and the reconcile. Everything is synthetic.

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveCache } from '@/lib/adapters/cache';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import type { PoolLike } from '@/lib/db/pool';
import { clearPurgersForTests, reconcileActiveSources, registerPurger, resetPurgeStateForTests } from '@/lib/sources/purge';
import { clearHevyConfigCache } from '@/lib/workout-sources/hevy/hevy-store';
import { heldSourceStatuses, loadTrainingData, purgeTrainingSources, resetTrainingStoreForTests } from '@/lib/workout-sources/store';

const held = vi.hoisted(() => ({ pool: null as PoolLike | null }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => held.pool }));

import { DELETE, GET, PUT } from './route';

const KEY = randomBytes(32);
const API_KEY = 'sample-hevy-api-key-ABCD1234';
const NEXT_KEY = 'sample-hevy-api-key-WXYZ9876';
const URL_ = 'http://hevy-sample.invalid:4000';

/** The table, plus the one other query the reconcile makes. */
function pool() {
  const db = fakeTable();
  const wrapped: PoolLike & { rows: typeof db.rows; marked: typeof db.marked; table: typeof db } = {
    rows: db.rows,
    marked: db.marked,
    table: db,
    query: (text, params) =>
      text.includes('lab_reports') ? Promise.resolve({ rows: [{ n: 0 }] }) : db.query(text, params),
  };
  return wrapped;
}

let db: ReturnType<typeof pool>;
let requests: { url: string; apiKey: string | undefined }[];
let reply: () => Response | Promise<Response>;
const out: string[] = [];
const texts: string[] = [];

const WORKOUTS_PAGE = () =>
  new Response(JSON.stringify({ page: 1, page_count: 1, workouts: [] }), { status: 200 });

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), apiKey: (init?.headers as Record<string, string>)?.['api-key'] });
      return reply();
    })
  );
}

const put = (body: unknown) =>
  PUT(new Request('http://app.test/api/sources/hevy', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

/** Reads a response once, keeping its text and headers for the leak scan. */
async function read(res: Response) {
  const text = await res.text();
  texts.push(text, JSON.stringify([...res.headers.entries()]));
  return { status: res.status, body: text ? JSON.parse(text) : null, text, res };
}

beforeEach(() => {
  db = pool();
  held.pool = db;
  requests = [];
  reply = WORKOUTS_PAGE;
  vi.stubEnv('VITAL_SECRET_KEY', KEY.toString('base64'));
  stubFetch();
  clearHevyConfigCache();
  resetTrainingStoreForTests();
  liveCache.clear();
  clearPurgersForTests();
  resetPurgeStateForTests();
  out.length = 0;
  texts.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void out.push(args.map(String).join(' ')));
  }
});

afterEach(() => {
  // No response, header or log line ever held a key, or a prefix of one.
  const all = [...texts, ...out].join('\n');
  for (const secret of [API_KEY, NEXT_KEY]) {
    expect(all).not.toContain(secret);
    expect(all).not.toContain(secret.slice(0, 16));
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetTrainingStoreForTests();
});

describe('GET /api/sources/hevy', () => {
  it('reports not connected, and that a secret key is available', async () => {
    const { status, body, res } = await read(await GET());
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, configured: false, url: null, keyLast4: null, needsReentry: false, lastError: null });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('reports available:false without a usable secret key', async () => {
    vi.stubEnv('VITAL_SECRET_KEY', 'not-a-key');
    expect((await read(await GET())).body.available).toBe(false);
    vi.stubEnv('VITAL_SECRET_KEY', '');
    expect((await read(await GET())).body.available).toBe(false);
  });

  it('never reads HEVY_API_KEY or HEVY_API_URL', async () => {
    vi.stubEnv('HEVY_API_URL', 'http://env-host.invalid');
    vi.stubEnv('HEVY_API_KEY', 'env-key-value-1234');
    const { body, text } = await read(await GET());
    expect(body.configured).toBe(false);
    expect(text).not.toContain('env-key');
    expect(text).not.toContain('env-host');
  });
});

describe('PUT /api/sources/hevy', () => {
  it('probes page 1 with the candidate, then stores it encrypted and reports only the last 4', async () => {
    const { status, body } = await read(await put({ apiKey: ` ${API_KEY} `, url: `  ${URL_}//  ` }));
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, configured: true, url: URL_, keyLast4: '1234', needsReentry: false, lastError: null });
    expect(requests).toEqual([{ url: `${URL_}/v1/workouts?page=1&pageSize=1`, apiKey: API_KEY }]);
    const row = db.rows.get('hevy')!;
    expect(row).toBeDefined();
    expect((row.ciphertext as Buffer).toString('utf8')).not.toContain('sample-hevy');
    expect(JSON.stringify(await read(await GET()))).not.toContain(API_KEY);
  });

  it('a blank URL means the Hevy API and is reported as null', async () => {
    const { body } = await read(await put({ apiKey: API_KEY, url: '  ' }));
    expect(body.url).toBeNull();
    expect(requests[0].url).toBe('https://api.hevyapp.com/v1/workouts?page=1&pageSize=1');
    requests = [];
    await put({ apiKey: API_KEY });
    expect(requests[0].url.startsWith('https://api.hevyapp.com/')).toBe(true);
  });

  it('rejects a URL that is not http(s) or carries credentials (400), without a request', async () => {
    for (const url of ['ftp://x.invalid', 'not a url', 'http://user:pw@x.invalid']) {
      expect((await read(await put({ apiKey: API_KEY, url }))).status).toBe(400);
    }
    expect((await read(await put({ apiKey: 7 }))).status).toBe(400);
    expect((await read(await put('not json'))).status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(db.rows.size).toBe(0);
  });

  it.each([
    [401, 'unauthorised', /refused the API key/],
    [403, 'unauthorised', /refused the API key/],
    [500, 'http_error', /HTTP 500/],
  ])('stores nothing when the server answers %i (422, %s)', async (code, kind, message) => {
    reply = () => new Response('{"error":"nope"}', { status: code });
    const { status, body } = await read(await put({ apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe(kind);
    expect(body.error).toMatch(message);
    expect(db.rows.size).toBe(0);
  });

  it('is 422 rate limited on a 429, after one request only', async () => {
    reply = () => new Response('{}', { status: 429 });
    const { status, body } = await read(await put({ apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe('rate_limited');
    expect(requests).toHaveLength(1);
    expect(db.rows.size).toBe(0);
  });

  it('is 422 unreachable when the request cannot be made', async () => {
    reply = () => Promise.reject(new TypeError('connect ECONNREFUSED'));
    const { status, body } = await read(await put({ apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe('unreachable');
    expect(db.rows.size).toBe(0);
  });

  it('is 422 timed out when the server does not answer, with the 8 s limit', async () => {
    const { HEVY_SAVE_PROBE_TIMEOUT_MS } = await import('@/lib/workout-sources/hevy/hevy-connect');
    expect(HEVY_SAVE_PROBE_TIMEOUT_MS).toBe(8000);
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            })
        )
      );
      const pending = put({ apiKey: API_KEY });
      await vi.advanceTimersByTimeAsync(HEVY_SAVE_PROBE_TIMEOUT_MS + 1);
      const { status, body } = await read(await pending);
      expect(status).toBe(422);
      expect(body.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
    expect(db.rows.size).toBe(0);
  });

  it('is 422 when the answer is not a workouts page', async () => {
    reply = () => new Response('{"hello":1}', { status: 200 });
    const { status, body } = await read(await put({ apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe('invalid_payload');
  });

  it('keeps the stored key when the key is omitted or blank, and uses it for the probe', async () => {
    await put({ apiKey: API_KEY, url: URL_ });
    requests = [];
    for (const body of [{ url: URL_ }, { apiKey: '   ', url: URL_ }, { apiKey: null, url: URL_ }]) {
      const res = await read(await put(body));
      expect(res.status).toBe(200);
      expect(res.body.keyLast4).toBe('1234');
    }
    expect(requests.every(r => r.apiKey === API_KEY)).toBe(true);
  });

  it('keeps the stored URL when it is omitted, and clears it when blank', async () => {
    await put({ apiKey: API_KEY, url: URL_ });
    expect((await read(await put({ apiKey: NEXT_KEY }))).body.url).toBe(URL_);
    expect((await read(await put({ url: '' }))).body.url).toBeNull();
  });

  it('replaces the key when a new one is sent', async () => {
    await put({ apiKey: API_KEY });
    const { body } = await read(await put({ apiKey: NEXT_KEY }));
    expect(body.keyLast4).toBe('9876');
    expect(requests.at(-1)?.apiKey).toBe(NEXT_KEY);
  });

  it('a failed probe leaves the previous connection as it was', async () => {
    await put({ apiKey: API_KEY, url: URL_ });
    reply = () => new Response('{}', { status: 401 });
    expect((await read(await put({ apiKey: NEXT_KEY, url: 'http://other.invalid' }))).status).toBe(422);
    reply = WORKOUTS_PAGE;
    const { body } = await read(await GET());
    expect(body).toMatchObject({ configured: true, url: URL_, keyLast4: '1234' });
  });

  it('is 400 with no stored key and none sent, and makes no request', async () => {
    expect((await read(await put({ url: URL_ }))).status).toBe(400);
    expect((await read(await put({}))).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('does not use HEVY_API_KEY from the environment as a stored key', async () => {
    vi.stubEnv('HEVY_API_KEY', 'env-key-value-1234');
    vi.stubEnv('HEVY_API_URL', 'http://env-host.invalid');
    expect((await read(await put({}))).status).toBe(400);
    await put({ apiKey: API_KEY });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ url: 'https://api.hevyapp.com/v1/workouts?page=1&pageSize=1', apiKey: API_KEY });
  });

  it('is 503 without a usable secret key, and makes no request', async () => {
    for (const value of ['', 'short']) {
      vi.stubEnv('VITAL_SECRET_KEY', value);
      const { status, body } = await read(await put({ apiKey: API_KEY }));
      expect(status).toBe(503);
      expect(body.error).toMatch(/secret key/);
    }
    expect(requests).toHaveLength(0);
    expect(db.rows.size).toBe(0);
  });

  it('is 503 with no database', async () => {
    held.pool = null;
    const { status, body } = await read(await put({ apiKey: API_KEY }));
    expect(status).toBe(503);
    expect(body.error).toMatch(/database/);
    expect(requests).toHaveLength(0);
  });

  it('a stored connection that needs re-entry is replaced by saving again', async () => {
    await put({ apiKey: API_KEY });
    vi.stubEnv('VITAL_SECRET_KEY', randomBytes(32).toString('base64'));
    clearHevyConfigCache();
    expect((await read(await GET())).body).toEqual({
      available: true, configured: true, url: null, keyLast4: null, needsReentry: true, lastError: null,
    });
    // Without a key to re-enter, the unreadable one cannot be kept.
    expect((await read(await put({}))).status).toBe(400);
    const { status, body } = await read(await put({ apiKey: NEXT_KEY }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ needsReentry: false, keyLast4: '9876' });
  });

  it('drops what the old connection synced, so a changed key never mixes accounts', async () => {
    await put({ apiKey: API_KEY });
    await syncOneSession();
    expect((await heldSourceStatuses({ env: live() }))[0].sessions).toBe(1);
    await put({ apiKey: NEXT_KEY });
    expect((await heldSourceStatuses({ env: live() }))[0]).toMatchObject({ sessions: 0, lastSyncAt: null });
  });

  it('reconciles: the active set gains the source', async () => {
    await reconcileActiveSources(); // the first set is only recorded
    await put({ apiKey: API_KEY });
    const purger = vi.fn();
    registerPurger('t', purger);
    await DELETE();
    expect(purger).toHaveBeenCalledWith(['hevy']);
  });
});

const live = () => ({ VITAL_DATA_MODE: 'live', VITAL_SECRET_KEY: KEY.toString('base64') }) as unknown as NodeJS.ProcessEnv;

async function syncOneSession() {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body =
      url.pathname === '/v1/workouts'
        ? {
            page: 1,
            page_count: 1,
            workouts: [
              {
                id: 'one',
                title: 'Upper',
                start_time: '2026-09-17T23:00:00Z',
                end_time: '2026-09-17T23:30:00Z',
                exercises: [{ title: 'Push Up', exercise_template_id: 'P', sets: [{ index: 0, type: 'normal', reps: 10 }] }],
              },
            ],
          }
        : { page: 1, page_count: 1, exercise_templates: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const data = await loadTrainingData({ env: live(), fetchImpl, now: () => Date.parse('2026-09-18T12:00:00Z') });
  expect(data.sessions).toHaveLength(1);
}

describe('DELETE /api/sources/hevy', () => {
  it('removes the credential and everything synced from it (204)', async () => {
    await put({ apiKey: API_KEY });
    await liveCache.getOrLoad('live-dataset:UTC:400:hae', async () => 'held');
    await syncOneSession();
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(db.rows.size).toBe(0);
    expect(liveCache.stats().keys).not.toContain('live-dataset:UTC:400:hae');
    expect((await heldSourceStatuses({ env: live() }))[0]).toMatchObject({
      configured: false, sessions: 0, lastSyncAt: null, lastError: null,
    });
    expect((await read(await GET())).body.configured).toBe(false);
    // Nothing is served any more.
    expect((await loadTrainingData({ env: live() })).sessions).toEqual([]);
  });

  it('works for an unreadable row even with no secret key', async () => {
    await put({ apiKey: API_KEY });
    vi.stubEnv('VITAL_SECRET_KEY', '');
    expect((await DELETE()).status).toBe(204);
    expect(db.rows.size).toBe(0);
  });

  it('is 503 with no database', async () => {
    held.pool = null;
    expect((await read(await DELETE())).status).toBe(503);
  });

  it('marks the removal on purpose, so the reconcile may erase the conversations', async () => {
    await put({ apiKey: API_KEY });
    expect([...db.marked]).toEqual([]);
    expect((await DELETE()).status).toBe(204);
    expect([...db.marked]).toEqual(['hevy']);
  });

  it('fails the request when the marker cannot be written', async () => {
    await put({ apiKey: API_KEY });
    db.table.markerError = new Error('connection reset');
    expect((await DELETE()).status).toBe(500);
    expect([...db.marked]).toEqual([]);
  });
});

describe('the status after a failed sync', () => {
  it('reports the failure without the key', async () => {
    await put({ apiKey: API_KEY });
    reply = () => new Response('{}', { status: 500 });
    await loadTrainingData({ env: live(), fetchImpl: globalThis.fetch, now: () => Date.parse('2026-09-18T12:00:00Z') });
    const { body } = await read(await GET());
    expect(body.lastError).toMatchObject({ kind: 'sync_failed' });
    expect(body.lastError.message).toMatch(/HTTP 500/);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it('purging the source clears the failure', async () => {
    await put({ apiKey: API_KEY });
    reply = () => new Response('{}', { status: 500 });
    await loadTrainingData({ env: live(), fetchImpl: globalThis.fetch });
    purgeTrainingSources(['hevy']);
    expect((await read(await GET())).body.lastError).toBeNull();
  });
});
