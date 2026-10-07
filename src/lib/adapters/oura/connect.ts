// ── Connect, callback, status and disconnect (SERVER ONLY) ───────────────────
//
// The logic behind /api/sources/oura/*. The route files only call these, because
// a Next.js route file may export nothing but its handlers.
//
// Every response is `private, no-store`. No body, header or redirect target ever
// holds an access token, a refresh token or the client secret: tokens go from
// Oura's reply straight into the encrypted credential row.

import { randomBytes } from 'node:crypto';
import { deleteCredential, getCredential, withLockedCredential } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';
import { clearLiveCaches } from '../live';
import { defaultContext } from '@/lib/sources/registry';
import { reconcileQuietly } from '@/lib/sources/purge';
import { ouraAppClientFor, saveStoredOuraApp } from './app-store';
import { readOuraConfig, type OuraConfig } from './config';
import { OuraAuthError, buildAuthorizeUrl, exchangeCode, pkcePair, revoke } from './oauth';
import { readOuraStatus, recordOuraOutcome } from './index';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  clearSessionCookie,
  openSession,
  readCookie,
  sameState,
  sealSession,
  setSessionCookie,
} from './session';
import { OURA_SOURCE_ID } from './tokens';

export interface ConnectDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  client?: PoolLike | null;
  now?: () => number;
}

const NO_STORE = 'private, no-store';

/**
 * Connect and disconnect change the active set: reconcile so everything held in
 * memory for a source that just went away is purged now, not at the next page.
 */
export async function reconcileAfterChange(env: NodeJS.ProcessEnv, deps: ConnectDeps): Promise<void> {
  let client: PoolLike | null = null;
  try {
    client = deps.client === undefined ? getPool(env) : deps.client;
  } catch {
    client = null;
  }
  await reconcileQuietly(defaultContext(env, () => client));
}

/** Record which client ID the stored login belongs to (null: no login). Keeps the app credentials as they are. */
async function bindLogin(env: NodeJS.ProcessEnv, client: PoolLike, cfg: OuraConfig, loginClientId: string | null) {
  await saveStoredOuraApp(
    { env, client },
    { clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri },
    { loginClientId }
  );
}

export function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE, ...extra },
  });
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': NO_STORE, ...extra } });
}

/** Back to Settings on the app's own origin (the registered redirect URI's origin). */
function settingsUrl(cfg: OuraConfig, outcome: 'connected' | 'denied'): string {
  return `${new URL(cfg.redirectUri).origin}/settings?tab=sources&oura=${outcome}`;
}

async function config(env: NodeJS.ProcessEnv, deps: ConnectDeps): Promise<{ cfg: OuraConfig; key: Buffer } | Response> {
  const read = await readOuraConfig({ env, client: ouraAppClientFor({ env, client: deps.client }) });
  const key = readSecretKey(env);
  if (!read || !read.ok || !key) {
    return json({ error: read && !read.ok ? read.reason : 'Oura app credentials are not set. Enter them in Settings → Sources.' }, 404);
  }
  return { cfg: read.config, key };
}

/** GET /api/sources/oura/authorize */
export async function authorize(request: Request, deps: ConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const c = await config(env, deps);
  if (c instanceof Response) return c;
  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkcePair();
  const sealed = sealSession({ state, verifier, ts: (deps.now ?? Date.now)() }, c.key);
  return redirect(buildAuthorizeUrl(c.cfg, state, challenge), { 'Set-Cookie': setSessionCookie(request, sealed) });
}

/** GET /api/sources/oura/callback */
export async function callback(request: Request, deps: ConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const c = await config(env, deps);
  if (c instanceof Response) return c;
  const now = deps.now ?? Date.now;
  const clear = { 'Set-Cookie': clearSessionCookie(request) };
  const params = new URL(request.url).searchParams;

  const error = params.get('error');
  if (error === 'access_denied') return redirect(settingsUrl(c.cfg, 'denied'), clear);
  if (error) return json({ error: 'Oura did not authorize the connection.' }, 400, clear);

  const session = openSession(readCookie(request.headers.get('cookie'), OAUTH_COOKIE), c.key);
  const age = session ? now() - session.ts : Infinity;
  const returned = params.get('state');
  if (!session || age > OAUTH_COOKIE_MAX_AGE_SECONDS * 1000 || age < -60_000) {
    return json({ error: 'The sign-in session is missing or has expired. Start again from Settings.' }, 400, clear);
  }
  if (!returned || !sameState(returned, session.state)) {
    return json({ error: 'The sign-in could not be verified. Start again from Settings.' }, 400, clear);
  }
  const code = params.get('code');
  if (!code) return json({ error: 'Oura returned no authorization code.' }, 400, clear);

  let tokens;
  try {
    tokens = await exchangeCode(c.cfg, code, session.verifier, { fetchImpl: deps.fetchImpl, now });
  } catch (e) {
    // The OuraAuthError message is fixed text and never carries a token or the secret.
    return json({ error: e instanceof OuraAuthError ? e.message : 'The token exchange failed.' }, 502, clear);
  }

  try {
    const client = deps.client === undefined ? getPool(env) : deps.client;
    if (!client) return json({ error: 'A database is required to store the connection.' }, 503, clear);
    // A reconnect is a new connection: delete first, in the same transaction as the write.
    await withLockedCredential(client, OURA_SOURCE_ID, c.key, async locked => {
      await locked.delete();
      await locked.put(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        tokens.scopes ?? c.cfg.scopes,
        tokens.expiresAt
      );
    });
    await bindLogin(env, client, c.cfg, c.cfg.clientId);
  } catch {
    return json({ error: 'The connection could not be stored.' }, 500, clear);
  }

  clearLiveCaches();
  await reconcileAfterChange(env, deps);
  recordOuraOutcome(null);
  return redirect(settingsUrl(c.cfg, 'connected'), clear);
}

/** GET /api/sources/oura */
export async function status(deps: ConnectDeps = {}): Promise<Response> {
  return json(await readOuraStatus({ env: deps.env, client: deps.client }), 200);
}

/** DELETE /api/sources/oura */
export async function disconnect(deps: ConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const c = await config(env, deps);
  if (c instanceof Response) return c;
  let client: PoolLike | null;
  try {
    client = deps.client === undefined ? getPool(env) : deps.client;
  } catch {
    client = null;
  }
  if (!client) return json({ error: 'A database is required to manage the connection.' }, 503);

  try {
    const cred = await getCredential(client, OURA_SOURCE_ID, c.key);
    if (cred && !cred.needsReconnect) {
      // Best effort: the row is deleted whether or not Oura answers.
      await revoke(c.cfg, cred.tokens.accessToken, { fetchImpl: deps.fetchImpl, now: deps.now }).catch(() => {});
    }
    await deleteCredential(client, OURA_SOURCE_ID);
    await bindLogin(env, client, c.cfg, null);
  } catch {
    return json({ error: 'The connection could not be removed.' }, 500);
  }
  clearLiveCaches();
  await reconcileAfterChange(env, deps);
  recordOuraOutcome(null);
  return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
}
