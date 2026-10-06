// ── Route tests: the stored Health Auto Export connection ────────────────────
//
// The real handlers run. Replaced: the Postgres pool (an in-memory table) and the
// network (a stub fetch that plays the export server). Real: the AES-GCM helper,
// the probe, the cache and the reconcile. Everything here is synthetic.

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveCache } from '@/lib/adapters/cache';
import { clearHaeConfigCache, recordHaeOutcome } from '@/lib/adapters/hae-store';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import type { PoolLike } from '@/lib/db/pool';
import { registerPurger, clearPurgersForTests, reconcileActiveSources, resetPurgeStateForTests } from '@/lib/sources/purge';

const held = vi.hoisted(() => ({ pool: null as PoolLike | null }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => held.pool }));

import { DELETE, GET, PUT } from './route';

const KEY = randomBytes(32);
const API_KEY = 'sample-hae-api-key-ABCD1234';
const NEXT_KEY = 'sample-hae-api-key-WXYZ9876';
const ENDPOINT = 'http://sample-host.invalid:3001';

/** The table, plus the one other query the reconcile makes. */
function pool() {
  const db = fakeTable();
  const wrapped: PoolLike & { rows: typeof db.rows } = {
    rows: db.rows,
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
  PUT(new Request('http://app.test/api/sources/hae', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

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
  reply = () => new Response('[]', { status: 200 });
  vi.stubEnv('VITAL_SECRET_KEY', KEY.toString('base64'));
  stubFetch();
  clearHaeConfigCache();
  recordHaeOutcome(null);
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPurgersForTests();
  resetPurgeStateForTests();
  // Whatever happened, neither key may appear in any response, header or log line.
  const everything = [...texts, ...out].join('\n');
  for (const secret of [API_KEY, NEXT_KEY, API_KEY.slice(0, 12), KEY.toString('base64')]) {
    expect(everything).not.toContain(secret);
  }
  for (const row of db.rows.values()) {
    expect(everything).not.toContain((row.ciphertext as Buffer).toString('base64'));
  }
});

describe('GET /api/sources/hae', () => {
  it('reports not connected, and that a secret key is available', async () => {
    const { status, body, res } = await read(await GET());
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, configured: false, endpoint: null, keyLast4: null, needsReentry: false, lastError: null });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('reports available:false without a usable secret key', async () => {
    vi.stubEnv('VITAL_SECRET_KEY', 'not-a-key');
    expect((await read(await GET())).body.available).toBe(false);
    vi.stubEnv('VITAL_SECRET_KEY', '');
    expect((await read(await GET())).body.available).toBe(false);
  });

  it('never reads HAE_API_URL or HAE_API_KEY', async () => {
    vi.stubEnv('HAE_API_URL', 'http://env-host.invalid');
    vi.stubEnv('HAE_API_KEY', 'env-key-value-1234');
    const { body, text } = await read(await GET());
    expect(body.configured).toBe(false);
    expect(text).not.toContain('env-key');
  });
});

describe('PUT /api/sources/hae', () => {
  it('probes with the candidate, then stores it encrypted and reports only the last 4', async () => {
    const { status, body } = await read(await put({ endpoint: `  ${ENDPOINT}//  `, apiKey: ` ${API_KEY} ` }));
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, configured: true, endpoint: ENDPOINT, keyLast4: '1234', needsReentry: false, lastError: null });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.startsWith(`${ENDPOINT}/api/metrics/`)).toBe(true);
    expect(requests[0].apiKey).toBe(API_KEY);
    const row = db.rows.get('hae')!;
    expect(row).toBeDefined();
    expect((row.ciphertext as Buffer).toString('utf8')).not.toContain('sample-hae');
    expect(JSON.stringify(await read(await GET()))).not.toContain(API_KEY);
  });

  it('stores nothing when the key is refused (422, unauthorised)', async () => {
    reply = () => new Response('{}', { status: 401 });
    const { status, body } = await read(await put({ endpoint: ENDPOINT, apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe('unauthorised');
    expect(body.error).toMatch(/refused/);
    expect(db.rows.size).toBe(0);
  });

  it.each([
    ['unreachable', () => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    ['timed out', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout'],
    ['server error', () => new Response('{}', { status: 500 }), 'http_error'],
    ['wrong data', () => new Response('{"a":1}', { status: 200 }), 'invalid_payload'],
  ])('stores nothing when the server is %s (422)', async (_label, fn, kind) => {
    reply = fn as () => Response;
    const { status, body } = await read(await put({ endpoint: ENDPOINT, apiKey: API_KEY }));
    expect(status).toBe(422);
    expect(body.kind).toBe(kind);
    expect(db.rows.size).toBe(0);
  });

  it('keeps the stored key when the key is omitted or blank, and uses it for the probe', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    requests = [];
    for (const extra of [{}, { apiKey: '' }, { apiKey: '   ' }, { apiKey: null }]) {
      const { status, body } = await read(await put({ endpoint: 'https://other.invalid/', ...extra }));
      expect(status).toBe(200);
      expect(body).toMatchObject({ endpoint: 'https://other.invalid', keyLast4: '1234' });
    }
    expect(requests.every(r => r.apiKey === API_KEY && r.url.startsWith('https://other.invalid/api/'))).toBe(true);
  });

  it('replaces the key when a new one is sent', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    const { body } = await read(await put({ endpoint: ENDPOINT, apiKey: NEXT_KEY }));
    expect(body.keyLast4).toBe('9876');
    expect(requests.at(-1)!.apiKey).toBe(NEXT_KEY);
  });

  it('a failed probe leaves the previous connection as it was', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    reply = () => new Response('{}', { status: 403 });
    expect((await read(await put({ endpoint: 'http://wrong.invalid', apiKey: NEXT_KEY }))).status).toBe(422);
    const { body } = await read(await GET());
    expect(body).toMatchObject({ endpoint: ENDPOINT, keyLast4: '1234' });
  });

  it('is 400 with no stored key and none sent, and makes no request', async () => {
    const { status, body } = await read(await put({ endpoint: ENDPOINT }));
    expect(status).toBe(400);
    expect(body.error).toMatch(/API key/);
    expect(requests).toHaveLength(0);
  });

  it('does not use HAE_API_KEY from the environment as a stored key', async () => {
    vi.stubEnv('HAE_API_KEY', 'env-key-value-1234');
    expect((await read(await put({ endpoint: ENDPOINT }))).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['not json', 'nope'],
    ['no endpoint', { apiKey: API_KEY }],
    ['not a url', { endpoint: 'sample host', apiKey: API_KEY }],
    ['ftp', { endpoint: 'ftp://sample-host.invalid', apiKey: API_KEY }],
    ['credentials in the url', { endpoint: 'http://user:pass@sample-host.invalid', apiKey: API_KEY }],
    ['key not text', { endpoint: ENDPOINT, apiKey: 42 }],
  ])('is 400 for %s, and stores nothing', async (_label, body) => {
    expect((await read(await put(body))).status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(db.rows.size).toBe(0);
  });

  it('is 503 without a usable secret key, and makes no request', async () => {
    for (const value of ['', 'short']) {
      vi.stubEnv('VITAL_SECRET_KEY', value);
      const { status, body } = await read(await put({ endpoint: ENDPOINT, apiKey: API_KEY }));
      expect(status).toBe(503);
      expect(body.error).toMatch(/secret key/);
    }
    expect(requests).toHaveLength(0);
    expect(db.rows.size).toBe(0);
  });

  it('is 503 with no database', async () => {
    held.pool = null;
    const { status, body } = await read(await put({ endpoint: ENDPOINT, apiKey: API_KEY }));
    expect(status).toBe(503);
    expect(body.error).toMatch(/database/);
    expect(requests).toHaveLength(0);
  });

  it('clears the live caches and reconciles', async () => {
    await reconcileActiveSources(); // the first set is only recorded
    await liveCache.getOrLoad('live-dataset:UTC:400:hae', async () => 'held');
    expect(liveCache.stats().keys).toContain('live-dataset:UTC:400:hae');
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    expect(liveCache.stats().keys).not.toContain('live-dataset:UTC:400:hae');
    // The reconcile saw HAE appear: removing it later reports it as removed.
    const purger = vi.fn();
    registerPurger('t', purger);
    await DELETE();
    expect(purger).toHaveBeenCalledWith(['hae']);
  });

  it('drops the medications window read through the old connection', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    await liveCache.getOrLoad('medications:UTC::', async () => 'held');
    await put({ endpoint: 'http://other.invalid', apiKey: NEXT_KEY });
    expect(liveCache.stats().keys).not.toContain('medications:UTC::');
  });

  it('a stored connection that needs re-entry is replaced by saving again', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    vi.stubEnv('VITAL_SECRET_KEY', randomBytes(32).toString('base64'));
    clearHaeConfigCache();
    expect((await read(await GET())).body).toEqual({
      available: true, configured: true, endpoint: null, keyLast4: null, needsReentry: true, lastError: null,
    });
    // Without a key to re-enter, the unreadable one cannot be kept.
    expect((await read(await put({ endpoint: ENDPOINT }))).status).toBe(400);
    const { status, body } = await read(await put({ endpoint: ENDPOINT, apiKey: NEXT_KEY }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ needsReentry: false, keyLast4: '9876' });
  });
});

describe('DELETE /api/sources/hae', () => {
  it('removes the credential and clears the caches (204)', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    await liveCache.getOrLoad('live-dataset:UTC:400:hae', async () => 'held');
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(db.rows.size).toBe(0);
    expect(liveCache.stats().keys).not.toContain('live-dataset:UTC:400:hae');
    expect((await read(await GET())).body.configured).toBe(false);
  });

  it('works for an unreadable row even with no secret key', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    vi.stubEnv('VITAL_SECRET_KEY', '');
    expect((await DELETE()).status).toBe(204);
    expect(db.rows.size).toBe(0);
  });

  it('is 503 with no database', async () => {
    held.pool = null;
    expect((await read(await DELETE())).status).toBe(503);
  });
});

describe('the pipeline reads the stored connection', () => {
  it('reports a failure of the stored connection in the status, without the key', async () => {
    await put({ endpoint: ENDPOINT, apiKey: API_KEY });
    const { fetchMetricRecords } = await import('@/lib/adapters/hae');
    reply = () => new Response('{}', { status: 401 });
    await expect(fetchMetricRecords('step_count', {})).rejects.toBeTruthy();
    const { body } = await read(await GET());
    expect(body.lastError).toMatchObject({ kind: 'http_error' });
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });
});
