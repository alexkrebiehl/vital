// ── Source credentials store: Postgres (SERVER ONLY) ─────
//
// The encrypted OAuth credentials of live data sources (db/migrations/0010).
// CREDENTIALS ONLY: no health value passes through here. The access and refresh
// tokens are one JSON document encrypted with AES-256-GCM under VITAL_SECRET_KEY.
//
// Every function takes its client and its key, so the SQL and the encryption run
// against an injected stand-in in the offline tests. A row written under another
// key, or one that fails to decrypt, reads as `{ needsReconnect: true }`; it is
// never decrypted with the wrong key and never throws.
//
// Nothing here logs. An error from the database or the crypto layer carries no
// token.

import { decryptJson, encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from './pool';
import { withTransaction } from './lab-store';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StoredCredential {
  needsReconnect: false;
  sourceId: string;
  tokens: OAuthTokens;
  /** Granted scopes, as stored. */
  scopes: string[];
  accessExpiresAt: Date;
  connectedAt: Date;
  updatedAt: Date;
  revision: number;
}

export type CredentialRead = StoredCredential | { needsReconnect: true; sourceId: string };

const COLUMNS =
  'source_id, ciphertext, iv, auth_tag, key_id, scopes, access_expires_at, connected_at, updated_at, revision';

function bytes(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
}

/**
 * Oura names granted scopes with a namespace ("extapi:daily"); the rest of Vital
 * uses the bare names it asked for ("daily"). Strip the namespace on the way in
 * and again on the way out, so credentials stored before this was handled work
 * without reconnecting.
 */
export function bareScope(scope: string): string {
  return scope.replace(/^extapi:/i, '');
}

function splitScopes(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(bareScope);
}

/** Read one row through the key. Never throws on a key mismatch or a bad row. */
export function toCredential(row: Record<string, unknown>, key: Buffer | null): CredentialRead {
  const sourceId = String(row.source_id);
  if (!key || String(row.key_id) !== keyId(key)) return { needsReconnect: true, sourceId };
  try {
    const plain = decryptJson<{ access_token?: unknown; refresh_token?: unknown }>(
      { ciphertext: bytes(row.ciphertext), iv: bytes(row.iv), authTag: bytes(row.auth_tag) },
      key
    );
    if (typeof plain.access_token !== 'string' || typeof plain.refresh_token !== 'string') {
      return { needsReconnect: true, sourceId };
    }
    return {
      needsReconnect: false,
      sourceId,
      tokens: { accessToken: plain.access_token, refreshToken: plain.refresh_token },
      scopes: splitScopes(row.scopes),
      accessExpiresAt: new Date(row.access_expires_at as string),
      connectedAt: new Date(row.connected_at as string),
      updatedAt: new Date(row.updated_at as string),
      revision: Number(row.revision),
    };
  } catch {
    return { needsReconnect: true, sourceId };
  }
}

/** The stored credential, `null` when none exists, or `{ needsReconnect: true }`. */
export async function getCredential(
  client: PoolLike,
  sourceId: string,
  key: Buffer | null
): Promise<CredentialRead | null> {
  const result = await client.query(`SELECT ${COLUMNS} FROM source_credentials WHERE source_id = $1`, [sourceId]);
  return result.rows[0] ? toCredential(result.rows[0], key) : null;
}

/** Whether a row exists, whatever key it was written under. Reads no token. */
export async function hasCredentialRow(client: PoolLike, sourceId: string): Promise<boolean> {
  const result = await client.query('SELECT 1 AS present FROM source_credentials WHERE source_id = $1', [sourceId]);
  return result.rows.length > 0;
}

const UPSERT = `
  INSERT INTO source_credentials (source_id, ciphertext, iv, auth_tag, key_id, scopes, access_expires_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (source_id) DO UPDATE
     SET ciphertext = EXCLUDED.ciphertext,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         key_id = EXCLUDED.key_id,
         scopes = EXCLUDED.scopes,
         access_expires_at = EXCLUDED.access_expires_at,
         updated_at = now(),
         revision = source_credentials.revision + 1`;

/**
 * Upsert the credential, encrypted. `connected_at` is kept on an update, so a
 * refresh does not look like a new connection; a reconnect deletes first.
 */
export async function putCredential(
  client: PoolLike,
  sourceId: string,
  tokens: OAuthTokens,
  scopes: string[],
  expiresAt: Date,
  key: Buffer | null
): Promise<void> {
  if (!key) throw new Error('No valid VITAL_SECRET_KEY is configured; credentials cannot be stored.');
  const parts = encryptJson({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken }, key);
  await client.query(UPSERT, [
    sourceId,
    parts.ciphertext,
    parts.iv,
    parts.authTag,
    keyId(key),
    scopes.join(' '),
    expiresAt.toISOString(),
  ]);
}

// ── Secret configuration (no OAuth tokens) ──────────────────────────────────
//
// A source configured by the user with a few secret string fields (Health Auto
// Export: endpoint and API key). Same table, same cipher, same key rules. The
// OAuth-only columns stay empty: `scopes` is '' and `access_expires_at` is NULL
// (migration 0013).

export type SecretConfigRead =
  | { needsReentry: false; sourceId: string; values: Record<string, string>; updatedAt: Date }
  | { needsReentry: true; sourceId: string };

/** Upsert the fields as one encrypted document. Throws only when there is no key. */
export async function putSecretConfig(
  client: PoolLike,
  sourceId: string,
  values: Record<string, string>,
  key: Buffer | null
): Promise<void> {
  if (!key) throw new Error('No valid VITAL_SECRET_KEY is configured; credentials cannot be stored.');
  const parts = encryptJson(values, key);
  await client.query(UPSERT, [sourceId, parts.ciphertext, parts.iv, parts.authTag, keyId(key), '', null]);
}

/** The stored fields, `null` when no row exists, or `{ needsReentry: true }` for any unreadable row. Never throws on a bad row. */
export async function getSecretConfig(
  client: PoolLike,
  sourceId: string,
  key: Buffer | null
): Promise<SecretConfigRead | null> {
  const result = await client.query(`SELECT ${COLUMNS} FROM source_credentials WHERE source_id = $1`, [sourceId]);
  const row = result.rows[0];
  if (!row) return null;
  if (!key || String(row.key_id) !== keyId(key)) return { needsReentry: true, sourceId };
  try {
    const plain = decryptJson<Record<string, unknown>>(
      { ciphertext: bytes(row.ciphertext), iv: bytes(row.iv), authTag: bytes(row.auth_tag) },
      key
    );
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(plain ?? {})) {
      if (typeof v !== 'string') return { needsReentry: true, sourceId };
      values[k] = v;
    }
    return { needsReentry: false, sourceId, values, updatedAt: new Date(row.updated_at as string) };
  } catch {
    return { needsReentry: true, sourceId };
  }
}

/** Delete the credential. Returns whether a row was removed. */
export async function deleteCredential(client: PoolLike, sourceId: string): Promise<boolean> {
  const result = await client.query('DELETE FROM source_credentials WHERE source_id = $1 RETURNING source_id', [
    sourceId,
  ]);
  return result.rows.length > 0;
}

/** What `fn` can do while it holds the row lock. Everything runs in one transaction. */
export interface LockedCredential {
  /** The row as read after the lock was taken; `null` when there is none. */
  current: CredentialRead | null;
  put(tokens: OAuthTokens, scopes: string[], expiresAt: Date): Promise<void>;
  delete(): Promise<boolean>;
}

/**
 * Run `fn` in a transaction holding `SELECT … FOR UPDATE` on the row. A second
 * caller blocks until this one commits, then reads the new tokens instead of
 * spending a refresh token that has already been used.
 */
export async function withLockedCredential<T>(
  client: PoolLike,
  sourceId: string,
  key: Buffer | null,
  fn: (locked: LockedCredential) => Promise<T>
): Promise<T> {
  return withTransaction(client, async tx => {
    const result = await tx.query(`SELECT ${COLUMNS} FROM source_credentials WHERE source_id = $1 FOR UPDATE`, [
      sourceId,
    ]);
    const current = result.rows[0] ? toCredential(result.rows[0], key) : null;
    return fn({
      current,
      put: (tokens, scopes, expiresAt) => putCredential(tx, sourceId, tokens, scopes, expiresAt, key),
      delete: () => deleteCredential(tx, sourceId),
    });
  });
}
