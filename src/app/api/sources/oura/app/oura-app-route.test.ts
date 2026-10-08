// ── Route tests: Oura app credentials (GET, PUT, DELETE /api/sources/oura/app) ──
//
// The real handlers run against an in-memory table and a stub fetch. Everything
// is synthetic. The point of most of these: the client secret never appears in
// a body, a header, a log line or an error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import { putCredential } from '@/lib/db/credentials-store';
import { clearOuraAppCache, readStoredOuraApp, saveStoredOuraApp } from '@/lib/adapters/oura/app-store';
import { liveCache } from '@/lib/adapters/cache';

const db = fakeTable();
vi.mock('@/lib/db/pool', () => ({ getPool: () => db }));

import { DELETE, GET, PUT } from './route';

const KEY = randomBytes(32);
const SECRET = 'xk93-sample-secret-9f8e7d6c';
const CALLBACK = 'http://localhost:8080/api/sources/oura/callback';
const BODY = { clientId: 'sample-client', clientSecret: SECRET, redirectUri: CALLBACK };

let fetched: string[] = [];
let logged: string[] = [];

beforeEach(() => {
  db.rows.clear();
  db.marked.clear();
  db.markerError = null;
  db.sent.length = 0;
  clearOuraAppCache();
  liveCache.clear();
  fetched = [];
  logged = [];
  vi.stubEnv('VITAL_SECRET_KEY', KEY.toString('base64'));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response('{}', { status: 200 });
  });
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function put(body: unknown, raw?: string): Request {
  return new Request('http://localhost:8080/api/sources/oura/app', {
    method: 'PUT',
    body: raw ?? JSON.stringify(body),
  });
}

/** Nothing secret in the status, any header, or any logged line. */
async function expectNoSecret(res: Response) {
  const text = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' + (await res.clone().text());
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(SECRET.slice(0, 12));
  expect(logged.join('\n')).not.toContain(SECRET);
}

describe('GET /api/sources/oura/app', () => {
  it('says not configured, and whether a secret key makes saving possible', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      available: true,
      configured: false,
      clientId: null,
      secretLast4: null,
      redirectUri: null,
      needsReentry: false,
    });
    vi.stubEnv('VITAL_SECRET_KEY', '');
    expect((await (await GET()).json()).available).toBe(false);
  });

  it('shows the client id in full, the secret only as its last 4, and never the secret', async () => {
    await saveStoredOuraApp({ env: process.env }, BODY);
    const res = await GET();
    expect(await res.clone().json()).toMatchObject({
      available: true,
      configured: true,
      clientId: 'sample-client',
      secretLast4: '7d6c',
      redirectUri: CALLBACK,
    });
    await expectNoSecret(res);
  });

  it('asks for the credentials again when the row cannot be read', async () => {
    await saveStoredOuraApp({ env: process.env }, BODY);
    clearOuraAppCache();
    vi.stubEnv('VITAL_SECRET_KEY', randomBytes(32).toString('base64'));
    expect(await (await GET()).json()).toMatchObject({ configured: true, needsReentry: true, clientId: null, secretLast4: null });
  });
});

describe('PUT /api/sources/oura/app', () => {
  it('stores the credentials encrypted and answers with the status, not the secret', async () => {
    const res = await PUT(put(BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.clone().json()).toMatchObject({ configured: true, clientId: 'sample-client', secretLast4: '7d6c', redirectUri: CALLBACK, warnings: [] });
    await expectNoSecret(res);
    const row = db.rows.get('oura-app')!;
    expect(Buffer.from(row.ciphertext as Buffer).toString('utf8')).not.toContain(SECRET);
    expect(await readStoredOuraApp({ env: process.env })).toMatchObject({ state: 'ok', clientSecret: SECRET });
    expect(fetched).toEqual([]);
  });

  it('keeps the stored secret when the new one is blank or absent', async () => {
    await PUT(put(BODY));
    expect((await PUT(put({ ...BODY, clientSecret: '' }))).status).toBe(200);
    expect((await PUT(put({ clientId: 'sample-client', redirectUri: CALLBACK }))).status).toBe(200);
    expect(await readStoredOuraApp({ env: process.env })).toMatchObject({ clientSecret: SECRET });
  });

  it('replaces the secret when a new one is given', async () => {
    await PUT(put(BODY));
    await PUT(put({ ...BODY, clientSecret: 'a-different-secret-0001' }));
    expect(await readStoredOuraApp({ env: process.env })).toMatchObject({ clientSecret: 'a-different-secret-0001' });
  });

  it('requires a secret the first time', async () => {
    const res = await PUT(put({ ...BODY, clientSecret: '  ' }));
    expect(res.status).toBe(400);
    expect(db.rows.has('oura-app')).toBe(false);
  });

  it('rejects a bad body without echoing it', async () => {
    for (const body of [{ ...BODY, clientId: '  ' }, { ...BODY, clientId: 5 }, { ...BODY, redirectUri: 'not a url' }, { ...BODY, redirectUri: 'ftp://localhost/cb' }, { ...BODY, clientSecret: 7 }]) {
      const res = await PUT(put(body));
      expect(res.status).toBe(400);
      await expectNoSecret(res);
    }
    const bad = await PUT(put(null, '{not json'));
    expect(bad.status).toBe(400);
    expect(db.rows.has('oura-app')).toBe(false);
  });

  it('allows plain http for localhost without a warning, and warns for any other host', async () => {
    expect((await (await PUT(put(BODY))).json()).warnings).toEqual([]);
    const res = await PUT(put({ ...BODY, redirectUri: 'http://vital.example.test/api/sources/oura/callback' }));
    expect(res.status).toBe(200);
    const warnings = (await res.json()).warnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/localhost/);
    expect((await (await PUT(put({ ...BODY, redirectUri: 'https://vital.example.test/api/sources/oura/callback' }))).json()).warnings).toEqual([]);
  });

  it('does not require the redirect URI to end with the callback path', async () => {
    expect((await PUT(put({ ...BODY, redirectUri: 'http://localhost:8080/somewhere' }))).status).toBe(200);
  });

  it('is a 503 with a plain message without a usable secret key, and stores nothing', async () => {
    vi.stubEnv('VITAL_SECRET_KEY', '');
    const res = await PUT(put(BODY));
    expect(res.status).toBe(503);
    expect((await res.clone().json()).error).toMatch(/VITAL_SECRET_KEY|secret key/i);
    await expectNoSecret(res);
    expect(db.rows.size).toBe(0);
  });

  it('records the client id of an existing login so a changed id marks it for reconnect', async () => {
    await PUT(put(BODY));
    await putCredential(db, 'oura', { accessToken: 'a', refreshToken: 'r' }, ['daily'], new Date('2099-01-01'), KEY);
    // First save with a login present and no recorded id: the login belongs to the stored id.
    await PUT(put({ ...BODY, clientSecret: '' }));
    expect(await readStoredOuraApp({ env: process.env })).toMatchObject({ loginClientId: 'sample-client' });
    await PUT(put({ ...BODY, clientId: 'another-client', clientSecret: '' }));
    const after = await readStoredOuraApp({ env: process.env });
    expect(after).toMatchObject({ clientId: 'another-client', loginClientId: 'sample-client' });
    expect(db.rows.has('oura')).toBe(true);
  });

  it('leaves a login alone when there is none to bind', async () => {
    await PUT(put(BODY));
    expect(await readStoredOuraApp({ env: process.env })).toMatchObject({ loginClientId: null });
  });

  it('drops the cached datasets', async () => {
    liveCache.getOrLoad('live-dataset:UTC:400:hae+oura', async () => 1);
    liveCache.getOrLoad('something-else', async () => 1);
    await liveCache.awaitIdle();
    await PUT(put(BODY));
    expect(liveCache.stats().keys).toEqual(['something-else']);
  });
});

describe('DELETE /api/sources/oura/app', () => {
  it('removes the credentials and the login, revoking best effort, and returns 204', async () => {
    await PUT(put(BODY));
    await putCredential(db, 'oura', { accessToken: 'sample-access', refreshToken: 'r' }, ['daily'], new Date('2099-01-01'), KEY);
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(db.rows.size).toBe(0);
    expect(fetched.some(u => u.includes('/oauth/revoke'))).toBe(true);
    await expectNoSecret(res);
  });

  it('removes the credentials even when Oura does not answer the revoke', async () => {
    await PUT(put(BODY));
    await putCredential(db, 'oura', { accessToken: 'sample-access', refreshToken: 'r' }, ['daily'], new Date('2099-01-01'), KEY);
    vi.stubGlobal('fetch', async () => {
      throw new Error(`offline ${SECRET}`);
    });
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(db.rows.size).toBe(0);
    await expectNoSecret(res);
  });

  it('removes a login left behind when the credentials are already gone', async () => {
    await putCredential(db, 'oura', { accessToken: 'a', refreshToken: 'r' }, ['daily'], new Date('2099-01-01'), KEY);
    expect((await DELETE()).status).toBe(204);
    expect(db.rows.size).toBe(0);
  });

  it('purges what the removed source left in memory', async () => {
    await PUT(put(BODY));
    liveCache.getOrLoad('live-dataset:UTC:400:oura', async () => 1);
    await liveCache.awaitIdle();
    await DELETE();
    expect(liveCache.stats().keys).toEqual([]);
  });

  it('marks the removal on purpose, so the reconcile may erase the conversations', async () => {
    await PUT(put(BODY));
    expect([...db.marked]).toEqual([]);
    expect((await DELETE()).status).toBe(204);
    expect([...db.marked]).toEqual(['oura']);
  });

  it('fails the request when the marker cannot be written', async () => {
    await PUT(put(BODY));
    db.markerError = new Error('connection reset');
    expect((await DELETE()).status).toBe(500);
    expect([...db.marked]).toEqual([]);
    db.markerError = null;
  });
});
