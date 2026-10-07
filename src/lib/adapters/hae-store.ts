// ── Stored Health Auto Export connection (SERVER ONLY) ───────────────────────
//
// The endpoint and API key live encrypted in Postgres (`source_credentials`,
// source_id 'hae'); the environment is never read for them. This module reads,
// writes and deletes that one row, keeps a short in-process cache of the read,
// and remembers the last upstream failure for the Settings card.
//
// A missing or unusable VITAL_SECRET_KEY, a row written under another key, a
// corrupt row and a missing database all read as "not usable" and never throw.
// Nothing here logs, and no value returned for display holds the key.

import { deleteCredential, getSecretConfig, putSecretConfig } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';

export const HAE_SOURCE_ID = 'hae';
/** How long a read of the stored row is reused. put and delete drop it at once. */
export const HAE_CONFIG_CACHE_MS = 20_000;

export interface HaeStoreDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  haeClient?: PoolLike | null;
  now?: () => number;
}

export type StoredHae =
  | { state: 'none' }
  | { state: 'needs_reentry' }
  | { state: 'ok'; endpoint: string; apiKey: string };

interface Entry {
  at: number;
  value: StoredHae;
}

let cache = new WeakMap<object, Entry>();
let lastError: { kind: string; message: string } | null = null;

/** Drop the cached read. Called by every write and delete. */
export function clearHaeConfigCache(): void {
  cache = new WeakMap();
}

export function recordHaeOutcome(error: { kind: string; message: string } | null): void {
  lastError = error;
}

export function lastHaeError(): { kind: string; message: string } | null {
  return lastError;
}

/** The pool, or null when there is no database or its settings are invalid. */
export function haeClientFor(deps: HaeStoreDeps = {}): PoolLike | null {
  if (deps.haeClient !== undefined) return deps.haeClient;
  try {
    return getPool(deps.env ?? process.env);
  } catch {
    return null;
  }
}

/** Whether VITAL_SECRET_KEY is present and usable. */
export function haeKeyUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  return readSecretKey(env) !== null;
}

/** The stored connection. Never throws; a database error reads as `none` and is not cached. */
export async function readStoredHae(deps: HaeStoreDeps = {}): Promise<StoredHae> {
  const client = haeClientFor(deps);
  if (!client) return { state: 'none' };
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(client);
  if (hit && now - hit.at < HAE_CONFIG_CACHE_MS) return hit.value;

  let value: StoredHae;
  try {
    const read = await getSecretConfig(client, HAE_SOURCE_ID, readSecretKey(deps.env ?? process.env));
    if (!read) value = { state: 'none' };
    else if (read.needsReentry) value = { state: 'needs_reentry' };
    else if (typeof read.values.endpoint === 'string' && typeof read.values.apiKey === 'string' && read.values.endpoint && read.values.apiKey) {
      value = { state: 'ok', endpoint: read.values.endpoint, apiKey: read.values.apiKey };
    } else value = { state: 'needs_reentry' };
  } catch {
    return { state: 'none' };
  }
  cache.set(client, { at: now, value });
  return value;
}

/** Encrypt and store the connection, then drop the cache. Throws when there is no database or no usable key. */
export async function saveStoredHae(
  deps: HaeStoreDeps,
  value: { endpoint: string; apiKey: string }
): Promise<void> {
  const client = haeClientFor(deps);
  if (!client) throw new Error('A database is required to store the connection.');
  await putSecretConfig(
    client,
    HAE_SOURCE_ID,
    { endpoint: value.endpoint, apiKey: value.apiKey },
    readSecretKey(deps.env ?? process.env)
  );
  clearHaeConfigCache();
  lastError = null;
}

/** Delete the stored connection, then drop the cache. Returns whether a row was removed. */
export async function removeStoredHae(deps: HaeStoreDeps = {}): Promise<boolean> {
  const client = haeClientFor(deps);
  if (!client) throw new Error('A database is required to manage the connection.');
  const removed = await deleteCredential(client, HAE_SOURCE_ID);
  clearHaeConfigCache();
  lastError = null;
  return removed;
}
