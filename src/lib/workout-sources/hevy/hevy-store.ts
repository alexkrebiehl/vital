// ── Stored Hevy connection (SERVER ONLY) ─────────────────────────────────────
//
// The API key and the optional API URL live encrypted in Postgres
// (`source_credentials`, source_id 'hevy'); the environment is never read for
// them. This module reads, writes and deletes that one row and keeps a short
// in-process cache of the read.
//
// A missing or unusable VITAL_SECRET_KEY, a row written under another key, a
// corrupt row and a missing database all read as "not usable" and never throw.
// Nothing here logs, and no value returned for display holds the key. The last
// sync failure shown on the card is the training store's (workout-sources/store).

import { deleteCredential, getSecretConfig, putSecretConfig } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { readSecretKey } from '@/lib/secrets/crypto';

export const HEVY_STORE_SOURCE_ID = 'hevy';
/** How long a read of the stored row is reused. save and remove drop it at once. */
export const HEVY_CONFIG_CACHE_MS = 20_000;

export interface HevyStoreDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  hevyClient?: PoolLike | null;
  now?: () => number;
}

/** What is stored. `url` is empty when the person left it blank (Hevy's own API). */
export interface HevyValues {
  apiKey: string;
  url: string;
}

export type StoredHevy = { state: 'none' } | { state: 'needs_reentry' } | ({ state: 'ok' } & HevyValues);

interface Entry {
  at: number;
  value: StoredHevy;
}

let cache = new WeakMap<object, Entry>();

/** Drop the cached read. Called by every write and delete. */
export function clearHevyConfigCache(): void {
  cache = new WeakMap();
}

/** The pool, or null when there is no database or its settings are invalid. */
export function hevyClientFor(deps: HevyStoreDeps = {}): PoolLike | null {
  if (deps.hevyClient !== undefined) return deps.hevyClient;
  try {
    return getPool(deps.env ?? process.env);
  } catch {
    return null;
  }
}

/** Whether VITAL_SECRET_KEY is present and usable. */
export function hevyKeyUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  return readSecretKey(env) !== null;
}

/** The stored connection. Never throws; a database error reads as `none` and is not cached. */
export async function readStoredHevy(deps: HevyStoreDeps = {}): Promise<StoredHevy> {
  const client = hevyClientFor(deps);
  if (!client) return { state: 'none' };
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(client);
  if (hit && now - hit.at < HEVY_CONFIG_CACHE_MS) return hit.value;

  let value: StoredHevy;
  try {
    const read = await getSecretConfig(client, HEVY_STORE_SOURCE_ID, readSecretKey(deps.env ?? process.env));
    if (!read) value = { state: 'none' };
    else if (read.needsReentry) value = { state: 'needs_reentry' };
    else {
      const { apiKey, url } = read.values;
      if (typeof apiKey === 'string' && apiKey && (url === undefined || typeof url === 'string')) {
        value = { state: 'ok', apiKey, url: url ?? '' };
      } else value = { state: 'needs_reentry' };
    }
  } catch {
    return { state: 'none' };
  }
  cache.set(client, { at: now, value });
  return value;
}

/** Encrypt and store the connection, then drop the cache. Throws when there is no database or no usable key. */
export async function saveStoredHevy(deps: HevyStoreDeps, value: HevyValues): Promise<void> {
  const client = hevyClientFor(deps);
  if (!client) throw new Error('A database is required to store the connection.');
  await putSecretConfig(
    client,
    HEVY_STORE_SOURCE_ID,
    { apiKey: value.apiKey, url: value.url },
    readSecretKey(deps.env ?? process.env)
  );
  clearHevyConfigCache();
}

/** Delete the stored connection, then drop the cache. Returns whether a row was removed. */
export async function removeStoredHevy(deps: HevyStoreDeps = {}): Promise<boolean> {
  const client = hevyClientFor(deps);
  if (!client) throw new Error('A database is required to manage the connection.');
  const removed = await deleteCredential(client, HEVY_STORE_SOURCE_ID);
  clearHevyConfigCache();
  return removed;
}
