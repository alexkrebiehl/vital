// ── Oura app credentials: status, save, remove (SERVER ONLY) ─────────────────
//
// The logic behind /api/sources/oura/app. The route file only calls these,
// because a Next.js route file may export nothing but its handlers.
//
// Every response is `private, no-store`. No body, header, error or log line
// holds the client secret, a prefix of it or the ciphertext: the only trace of
// it is its last 4 characters, in the status. Messages are fixed text.

import { deleteCredential, getCredential, hasCredentialRow } from '@/lib/db/credentials-store';
import type { PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';
import { clearRouteStore } from '@/lib/activity-maps/routes';
import { clearLiveCaches } from '../live';
import { readOuraConfig } from './config';
import {
  clearOuraAppCache,
  last4OfSecret,
  ouraAppClientFor,
  readStoredOuraApp,
  removeStoredOuraApp,
  saveStoredOuraApp,
  type StoredOuraApp,
} from './app-store';
import { revoke } from './oauth';
import { OURA_SOURCE_ID } from './tokens';
import { json, reconcileAfterChange, type ConnectDeps } from './connect';
import { recordOuraOutcome } from './index';

const NO_STORE = 'private, no-store';

export interface OuraAppStatus {
  /** VITAL_SECRET_KEY is present and usable, so credentials can be stored. */
  available: boolean;
  configured: boolean;
  /** Shown in full: a client ID is not a secret. */
  clientId: string | null;
  secretLast4: string | null;
  redirectUri: string | null;
  /** Stored, but written under another key or unreadable: enter them again. */
  needsReentry: boolean;
}

function toStatus(stored: StoredOuraApp, available: boolean): OuraAppStatus {
  if (stored.state === 'none') {
    return { available, configured: false, clientId: null, secretLast4: null, redirectUri: null, needsReentry: false };
  }
  if (stored.state === 'needs_reentry') {
    return { available, configured: true, clientId: null, secretLast4: null, redirectUri: null, needsReentry: true };
  }
  return {
    available,
    configured: true,
    clientId: stored.clientId,
    secretLast4: last4OfSecret(stored.clientSecret),
    redirectUri: stored.redirectUri,
    needsReentry: false,
  };
}

function storeDeps(deps: ConnectDeps) {
  return { env: deps.env ?? process.env, client: deps.client };
}

async function statusBody(deps: ConnectDeps): Promise<OuraAppStatus> {
  const env = deps.env ?? process.env;
  return toStatus(await readStoredOuraApp(storeDeps(deps)), readSecretKey(env) !== null);
}

/** What was read through the old credentials must not outlive them. */
function clearOuraCaches(): void {
  clearLiveCaches();
  clearRouteStore();
  clearOuraAppCache();
  recordOuraOutcome(null);
}

/** GET /api/sources/oura/app */
export async function appStatus(deps: ConnectDeps = {}): Promise<Response> {
  return json(await statusBody(deps), 200);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The redirect URI trimmed, or null when it is not an http(s) URL. */
export function normalizeRedirectUri(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
  } catch {
    return null;
  }
  return trimmed;
}

/** Plain http works with Oura only for localhost; any other host is allowed but flagged. */
export function redirectWarnings(redirectUri: string): string[] {
  const url = new URL(redirectUri);
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return ['Oura accepts a plain http redirect URI only for localhost. Use https for any other address, or Oura may refuse the sign-in.'];
  }
  return [];
}

/** PUT /api/sources/oura/app { clientId, clientSecret?, redirectUri } */
export async function appSave(request: Request, deps: ConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body must be JSON.' }, 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof input.clientId !== 'string' || !input.clientId.trim()) {
    return json({ error: 'The client ID is required.' }, 400);
  }
  const clientId = input.clientId.trim();
  const redirectUri = normalizeRedirectUri(input.redirectUri);
  if (!redirectUri) {
    return json({ error: 'The redirect URI must be an http or https address, without a user name or password.' }, 400);
  }
  if (input.clientSecret !== undefined && input.clientSecret !== null && typeof input.clientSecret !== 'string') {
    return json({ error: 'The client secret must be text.' }, 400);
  }
  const submitted = typeof input.clientSecret === 'string' ? input.clientSecret.trim() : '';

  if (readSecretKey(env) === null) {
    return json(
      { error: 'The server has no usable secret key (VITAL_SECRET_KEY), so the credentials cannot be stored. Run the database setup to create one.' },
      503
    );
  }
  const client = ouraAppClientFor(storeDeps(deps));
  if (!client) return json({ error: 'A database is required to store the credentials.' }, 503);

  const stored = await readStoredOuraApp(storeDeps(deps));
  // Omitted or blank: keep the stored secret, if there is one.
  let clientSecret = submitted;
  if (!clientSecret) {
    if (stored.state !== 'ok') return json({ error: 'The client secret is required.' }, 400);
    clientSecret = stored.clientSecret;
  }

  // Which client ID the stored login belongs to: what was recorded; else the ID the app held
  // before this save; else, for a login that predates the stored credentials, the ID being saved.
  let loginClientId: string | null = null;
  try {
    if (await hasCredentialRow(client, OURA_SOURCE_ID)) {
      loginClientId = stored.state === 'ok' ? (stored.loginClientId ?? stored.clientId) : clientId;
    }
    await saveStoredOuraApp(storeDeps(deps), { clientId, clientSecret, redirectUri }, { loginClientId });
  } catch {
    return json({ error: 'The credentials could not be stored.' }, 500);
  }
  clearOuraCaches();
  await reconcileAfterChange(env, deps);
  return json({ ...(await statusBody(deps)), warnings: redirectWarnings(redirectUri) }, 200);
}

/** DELETE /api/sources/oura/app: remove the credentials and, since Connect is impossible without them, the login. */
export async function appRemove(deps: ConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const client = ouraAppClientFor(storeDeps(deps));
  if (!client) return json({ error: 'A database is required to manage the credentials.' }, 503);

  try {
    const read = await readOuraConfig({ env, client });
    const key = readSecretKey(env);
    if (read && read.ok && key) {
      const cred = await getCredential(client, OURA_SOURCE_ID, key);
      if (cred && !cred.needsReconnect) {
        // Best effort: everything is deleted whether or not Oura answers.
        await revoke(read.config, cred.tokens.accessToken, { fetchImpl: deps.fetchImpl, now: deps.now }).catch(() => {});
      }
    }
    await deleteCredential(client, OURA_SOURCE_ID);
    await removeStoredOuraApp(storeDeps(deps));
  } catch {
    return json({ error: 'The credentials could not be removed.' }, 500);
  }
  clearOuraCaches();
  await reconcileAfterChange(env, deps);
  return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
}
