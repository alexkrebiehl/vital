// ── Route tests: Oura connect, callback, status, disconnect ──────────────────
//
// The real handlers run. Replaced: the Postgres pool (an in-memory table), the
// network (a stub fetch that plays Oura), and the clock. Real: the AES-GCM
// helper, the OAuth helpers, the state comparison. Everything here is synthetic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fakeTable } from '@/lib/db/credentials-store.fake';
import { clearOuraAppCache, readStoredOuraApp, saveStoredOuraApp } from '@/lib/adapters/oura/app-store';
import { getCredential } from '@/lib/db/credentials-store';
import { liveCache } from '@/lib/adapters/cache';
import { OAUTH_COOKIE, openSession, sealSession } from '@/lib/adapters/oura/session';

const hoisted = vi.hoisted(() => ({ compared: 0 }));
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      hoisted.compared += 1;
      return actual.timingSafeEqual(a, b);
    },
  };
});

const db = fakeTable();
vi.mock('@/lib/db/pool', () => ({ getPool: () => db }));

import { GET as authorizeRoute } from './authorize/route';
import { GET as callbackRoute } from './callback/route';
import { DELETE as disconnectRoute, GET as statusRoute } from './route';

const KEY = randomBytes(32);
const CLIENT_SECRET = 'sample-client-secret';
const ACCESS = 'sample-access-token-xyz';
const REFRESH = 'sample-refresh-token-xyz';
const ORIGIN = 'http://localhost:8080';
const CALLBACK = `${ORIGIN}/api/sources/oura/callback`;
const NOW = Date.parse('2026-10-04T12:00:00Z');

/** The app credentials are stored in Settings (encrypted in the table); the environment holds admin values only. */
async function configure(extra: Record<string, string> = {}) {
  vi.stubEnv('OURA_API_URL', 'http://oura.test');
  vi.stubEnv('VITAL_SECRET_KEY', KEY.toString('base64'));
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
  await saveStoredOuraApp(
    { env: process.env },
    { clientId: 'sample-client', clientSecret: CLIENT_SECRET, redirectUri: CALLBACK }
  );
}

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: string;
}
let seen: Seen[] = [];
let tokenReply: () => Response;

beforeEach(() => {
  seen = [];
  db.rows.clear();
  clearOuraAppCache();
  db.sent.length = 0;
  hoisted.compared = 0;
  liveCache.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  tokenReply = () =>
    new Response(
      JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 86400, scope: 'daily heartrate', token_type: 'bearer' }),
      { status: 200 }
    );
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: String(input), method: init?.method ?? 'GET', auth: headers.Authorization ?? null, body: String(init?.body ?? '') });
    if (String(input).endsWith('/oauth/token')) return tokenReply();
    if (String(input).includes('/oauth/revoke')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function cookieOf(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  return header.split(';')[0];
}

async function startSignIn(): Promise<{ state: string; verifier: string; cookie: string }> {
  const res = await authorizeRoute(new Request(`${ORIGIN}/api/sources/oura/authorize`));
  const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
  const session = openSession(cookieOf(res).slice(OAUTH_COOKIE.length + 1), KEY)!;
  return { state, verifier: session.verifier, cookie: cookieOf(res) };
}

function callbackRequest(query: string, cookie?: string): Request {
  return new Request(`${CALLBACK}?${query}`, { headers: cookie ? { cookie } : {} });
}

/** Nothing secret in the status, body, Location or any header. */
async function expectNoSecrets(res: Response) {
  const text = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' + (await res.clone().text());
  for (const secret of [ACCESS, REFRESH, CLIENT_SECRET]) expect(text).not.toContain(secret);
}

describe('GET /api/sources/oura/authorize', () => {
  it('is a 404 JSON when Oura is not configured', async () => {
    const res = await authorizeRoute(new Request(`${ORIGIN}/api/sources/oura/authorize`));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('redirects to Oura with state and a PKCE challenge, and seals both in a cookie', async () => {
    await configure();
    const res = await authorizeRoute(new Request(`${ORIGIN}/api/sources/oura/authorize`));
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://cloud.ouraring.com/oauth/authorize');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK);
    const state = location.searchParams.get('state')!;
    expect(state.length).toBeGreaterThanOrEqual(24);

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${OAUTH_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/api/sources/oura');
    expect(setCookie).toContain('Max-Age=600');
    expect(setCookie).not.toContain('Secure');
    // Encrypted: neither the state nor the verifier is readable in the cookie.
    const session = openSession(cookieOf(res).slice(OAUTH_COOKIE.length + 1), KEY)!;
    expect(session.state).toBe(state);
    expect(setCookie).not.toContain(state);
    expect(setCookie).not.toContain(session.verifier);
    expect(location.searchParams.get('code_challenge')).not.toBe(session.verifier);
    await expectNoSecrets(res);
  });

  it('marks the cookie Secure behind https', async () => {
    await configure();
    const res = await authorizeRoute(
      new Request(`${ORIGIN}/api/sources/oura/authorize`, { headers: { 'x-forwarded-proto': 'https' } })
    );
    expect(res.headers.get('set-cookie')).toContain('; Secure');
  });
});

describe('GET /api/sources/oura/callback', () => {
  it('sends a refused sign-in back to Settings without any exchange', async () => {
    await configure();
    const res = await callbackRoute(callbackRequest('error=access_denied'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/settings?tab=connections&oura=denied`);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(seen).toHaveLength(0);
  });

  it('rejects a missing cookie, with no exchange', async () => {
    await configure();
    const res = await callbackRoute(callbackRequest('code=abc&state=whatever'));
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
    expect(db.rows.has('oura')).toBe(false);
  });

  it('rejects a state that does not match, comparing in constant time', async () => {
    await configure();
    const { cookie } = await startSignIn();
    const res = await callbackRoute(callbackRequest('code=abc&state=not-the-state', cookie));
    expect(res.status).toBe(400);
    expect(hoisted.compared).toBeGreaterThan(0);
    expect(seen).toHaveLength(0);
    expect(db.rows.has('oura')).toBe(false);
  });

  it('rejects a missing state, a missing code and a tampered cookie', async () => {
    await configure();
    const { state, cookie } = await startSignIn();
    expect((await callbackRoute(callbackRequest('code=abc', cookie))).status).toBe(400);
    expect((await callbackRoute(callbackRequest(`state=${state}`, cookie))).status).toBe(400);
    const tampered = cookie.slice(0, -3) + (cookie.endsWith('AAA') ? 'BBB' : 'AAA');
    expect((await callbackRoute(callbackRequest(`code=abc&state=${state}`, tampered))).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('rejects a cookie sealed under another key', async () => {
    await configure();
    const { state } = await startSignIn();
    const foreign = `${OAUTH_COOKIE}=${sealSession({ state, verifier: 'v', ts: NOW }, randomBytes(32))}`;
    expect((await callbackRoute(callbackRequest(`code=abc&state=${state}`, foreign))).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('rejects a sign-in older than ten minutes', async () => {
    await configure();
    const { state, cookie } = await startSignIn();
    vi.setSystemTime(NOW + 10 * 60_000 + 1000);
    const res = await callbackRoute(callbackRequest(`code=abc&state=${state}`, cookie));
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('exchanges the code, stores the encrypted tokens with the granted scopes and clears the caches', async () => {
    await configure();
    liveCache.getOrLoad('live-dataset:UTC:400:hae', async () => 1);
    liveCache.getOrLoad('oura:UTC:400', async () => 1);
    liveCache.getOrLoad('something-else', async () => 1);
    await liveCache.awaitIdle();
    const { state, verifier, cookie } = await startSignIn();

    const res = await callbackRoute(callbackRequest(`code=sample-code&state=${state}`, cookie));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/settings?tab=connections&oura=connected`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    await expectNoSecrets(res);

    const exchange = seen.filter(s => s.url.endsWith('/oauth/token'));
    expect(exchange).toHaveLength(1);
    const form = new URLSearchParams(exchange[0].body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('sample-code');
    expect(form.get('code_verifier')).toBe(verifier);
    expect(exchange[0].auth).toMatch(/^Basic /);

    const stored = await getCredential(db, 'oura', KEY);
    expect(stored && !stored.needsReconnect && stored.tokens).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(stored && !stored.needsReconnect && stored.scopes).toEqual(['daily', 'heartrate']);
    // The row on disk holds ciphertext only.
    const row = db.rows.get('oura')!;
    expect(Buffer.from(row.ciphertext as Buffer).toString('utf8')).not.toContain(ACCESS);
    expect(liveCache.stats().keys).toEqual(['something-else']);
  });

  it('stores the requested scopes when the reply does not list the granted ones', async () => {
    await configure();
    tokenReply = () =>
      new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }), { status: 200 });
    const { state, cookie } = await startSignIn();
    await callbackRoute(callbackRequest(`code=c&state=${state}`, cookie));
    const stored = await getCredential(db, 'oura', KEY);
    expect(stored && !stored.needsReconnect && stored.scopes).toEqual(['daily', 'heartrate', 'workout', 'spo2']);
  });

  it('reports a refused exchange without storing anything or leaking a secret', async () => {
    await configure();
    tokenReply = () => new Response(JSON.stringify({ error: 'invalid_grant', detail: CLIENT_SECRET }), { status: 400 });
    const { state, cookie } = await startSignIn();
    const res = await callbackRoute(callbackRequest(`code=bad&state=${state}`, cookie));
    expect(res.status).toBe(502);
    expect(db.rows.has('oura')).toBe(false);
    await expectNoSecrets(res);
  });
});

describe('GET /api/sources/oura', () => {
  it('says not configured when it is not', async () => {
    const res = await statusRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ configured: false, connected: false });
  });

  it('is ready to connect before the first sign-in', async () => {
    await configure();
    expect(await (await statusRoute()).json()).toMatchObject({ configured: true, connected: false, needsReconnect: false });
  });

  it('reports scopes and missing scopes, and nothing secret, once connected', async () => {
    await configure();
    const { state, cookie } = await startSignIn();
    await callbackRoute(callbackRequest(`code=c&state=${state}`, cookie));
    const res = await statusRoute();
    const body = await res.clone().json();
    expect(body).toMatchObject({
      configured: true,
      connected: true,
      scopes: ['daily', 'heartrate'],
      missingScopes: ['workout', 'spo2'],
      needsReconnect: false,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['accessExpiresAt', 'configProblem', 'configured', 'connected', 'lastError', 'missingScopes', 'needsReconnect', 'scopes'].sort()
    );
    await expectNoSecrets(res);
  });
});

describe('DELETE /api/sources/oura', () => {
  async function connect() {
    const { state, cookie } = await startSignIn();
    await callbackRoute(callbackRequest(`code=c&state=${state}`, cookie));
    seen = [];
  }

  it('is a 404 when Oura is not configured', async () => {
    expect((await disconnectRoute()).status).toBe(404);
  });

  it('revokes, deletes the credential, clears the caches and returns 204', async () => {
    await configure();
    await connect();
    liveCache.getOrLoad('live-dataset:UTC:400:hae+oura', async () => 1);
    await liveCache.awaitIdle();

    const res = await disconnectRoute();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('');
    expect(db.rows.has('oura')).toBe(false);
    // Disconnecting does not remove the app credentials, and the login no longer binds a client id.
    expect(db.rows.has('oura-app')).toBe(true);
    expect(liveCache.stats().keys).toEqual([]);
    const revoke = seen.filter(s => s.url.includes('/oauth/revoke'));
    expect(revoke).toHaveLength(1);
    await expectNoSecrets(res);
  });

  it('deletes the credential even when Oura does not answer the revoke', async () => {
    await configure();
    await connect();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect((await disconnectRoute()).status).toBe(204);
    expect(db.rows.has('oura')).toBe(false);
  });
});

describe('the login and the client id it was issued for', () => {
  async function connect() {
    const { state, cookie } = await startSignIn();
    await callbackRoute(callbackRequest(`code=c&state=${state}`, cookie));
  }

  it('records the client id on connect and clears it on disconnect', async () => {
    await configure();
    await connect();
    const bound = await readStoredOuraApp({ env: process.env });
    expect(bound.state === 'ok' && bound.loginClientId).toBe('sample-client');
    await disconnectRoute();
    const cleared = await readStoredOuraApp({ env: process.env });
    expect(cleared.state === 'ok' && cleared.loginClientId).toBeNull();
  });

  it('keeps the login valid when the same client id is saved again', async () => {
    await configure();
    await connect();
    const bound = await readStoredOuraApp({ env: process.env });
    if (bound.state !== 'ok') throw new Error('expected stored credentials');
    await saveStoredOuraApp({ env: process.env }, bound, { loginClientId: bound.loginClientId });
    expect(await (await statusRoute()).json()).toMatchObject({ connected: true, needsReconnect: false });
  });

  it('marks the login as needing a reconnect, without deleting it, when the client id changed', async () => {
    await configure();
    await connect();
    await saveStoredOuraApp(
      { env: process.env },
      { clientId: 'another-client', clientSecret: CLIENT_SECRET, redirectUri: CALLBACK },
      { loginClientId: 'sample-client' }
    );
    const body = await (await statusRoute()).json();
    expect(body).toMatchObject({ connected: false, needsReconnect: true });
    expect(db.rows.has('oura')).toBe(true);
  });
});
