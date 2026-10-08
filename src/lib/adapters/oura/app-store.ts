// ── Stored Oura app credentials (SERVER ONLY) ────────────────────────────────
//
// The Oura app's client ID, client secret and redirect URI live encrypted in
// Postgres (`source_credentials`, source_id 'oura-app'); the environment is
// never read for them. The Oura LOGIN (access and refresh token) stays in its
// own row, source_id 'oura'.
//
// `loginClientId` is the client ID the stored login was issued for. Entering
// the same ID again keeps the login valid; a different ID leaves the login in
// place but unusable ("needs reconnect"), because Oura refreshes a token only
// for the app that issued it. A login with no recorded ID counts as matching.
//
// A missing or unusable VITAL_SECRET_KEY, a row written under another key, a
// corrupt row and a missing database all read as "not usable" and never throw.
// Nothing here logs, and nothing returned for display holds the secret.

import { deleteCredential, getSecretConfig, putSecretConfig } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';

export const OURA_APP_SOURCE_ID = 'oura-app';
/** How long a read of the stored row is reused. save and remove drop it at once. */
export const OURA_APP_CACHE_MS = 20_000;

export interface OuraAppDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  client?: PoolLike | null;
  now?: () => number;
}

export interface OuraAppValues {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type StoredOuraApp =
  | { state: 'none' }
  | { state: 'needs_reentry' }
  | ({ state: 'ok'; loginClientId: string | null } & OuraAppValues);

interface Entry {
  at: number;
  value: StoredOuraApp;
}

let cache = new WeakMap<object, Entry>();

/** Drop the cached read. Called by every write and delete. */
export function clearOuraAppCache(): void {
  cache = new WeakMap();
}

/** The pool, or null when there is no database or its settings are invalid. */
export function ouraAppClientFor(deps: OuraAppDeps = {}): PoolLike | null {
  if (deps.client !== undefined) return deps.client;
  try {
    return getPool(deps.env ?? process.env);
  } catch {
    return null;
  }
}

/** The last 4 characters, only when the secret is long enough that this reveals little. */
export function last4OfSecret(secret: string): string | null {
  return secret.length >= 8 ? secret.slice(-4) : null;
}

/** True when a login exists under one client ID and the app now names another. */
export function loginNeedsReconnect(app: StoredOuraApp | null): boolean {
  return app !== null && app.state === 'ok' && app.loginClientId !== null && app.loginClientId !== app.clientId;
}

/** The stored app credentials. Never throws; a database error reads as `none` and is not cached. */
export async function readStoredOuraApp(deps: OuraAppDeps = {}): Promise<StoredOuraApp> {
  const client = ouraAppClientFor(deps);
  if (!client) return { state: 'none' };
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(client);
  if (hit && now - hit.at < OURA_APP_CACHE_MS) return hit.value;

  let value: StoredOuraApp;
  try {
    const read = await getSecretConfig(client, OURA_APP_SOURCE_ID, readSecretKey(deps.env ?? process.env));
    const v = read && !read.needsReentry ? read.values : null;
    if (!read) value = { state: 'none' };
    else if (!v || !v.clientId || !v.clientSecret || !v.redirectUri) value = { state: 'needs_reentry' };
    else {
      value = {
        state: 'ok',
        clientId: v.clientId,
        clientSecret: v.clientSecret,
        redirectUri: v.redirectUri,
        loginClientId: v.loginClientId ? v.loginClientId : null,
      };
    }
  } catch {
    return { state: 'none' };
  }
  cache.set(client, { at: now, value });
  return value;
}

/**
 * Encrypt and store the app credentials, then drop the cache. Throws when there
 * is no database or no usable key. `loginClientId` is written as given; pass
 * `null` for "no login recorded".
 */
export async function saveStoredOuraApp(
  deps: OuraAppDeps,
  value: OuraAppValues,
  options: { loginClientId?: string | null } = {}
): Promise<void> {
  const client = ouraAppClientFor(deps);
  if (!client) throw new Error('A database is required to store the credentials.');
  const values: Record<string, string> = {
    clientId: value.clientId,
    clientSecret: value.clientSecret,
    redirectUri: value.redirectUri,
  };
  if (options.loginClientId) values.loginClientId = options.loginClientId;
  await putSecretConfig(client, OURA_APP_SOURCE_ID, values, readSecretKey(deps.env ?? process.env));
  clearOuraAppCache();
}

/** Delete the stored app credentials, then drop the cache. Returns whether a row was removed. */
export async function removeStoredOuraApp(deps: OuraAppDeps = {}): Promise<boolean> {
  const client = ouraAppClientFor(deps);
  if (!client) throw new Error('A database is required to manage the credentials.');
  const removed = await deleteCredential(client, OURA_APP_SOURCE_ID);
  clearOuraAppCache();
  return removed;
}
