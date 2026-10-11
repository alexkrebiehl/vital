// ── AI providers and assignments: Postgres (SERVER ONLY) ─
//
// The rows of db/migrations/0017. CONFIGURATION ONLY: no health value passes
// through here. A provider's API key is one JSON document encrypted with
// AES-256-GCM under VITAL_SECRET_KEY, as in the source credentials store.
//
// Every function takes its client, the user and (where a key is involved) the
// secret key, so the SQL runs against an injected stand-in in the offline tests.
// Every statement filters on `user_id`: a provider id that belongs to another
// user reads as absent, and an update or delete of one changes nothing.
//
// A key written under another secret key, or one that fails to decrypt, reads
// as `keyState: 'needs_reentry'`; it is never decrypted with the wrong key and a
// read never throws for it. Nothing here logs.

import { decryptJson, encryptJson, keyId } from '@/lib/secrets/crypto';
import {
  AI_PROVIDER_KINDS,
  AI_USES,
  parseOptions,
  type AiAssignment,
  type AiKeyState,
  type AiOptions,
  type AiProviderKind,
  type AiProviderRecord,
  type AiUse,
} from '@/lib/ai/types';
import type { PoolLike } from './pool';

const PROVIDER_COLUMNS = 'id, name, kind, base_url, ciphertext, iv, auth_tag, key_id, updated_at, revision';
const ASSIGNMENT_COLUMNS = 'use, provider_id, model, options, updated_at, revision';

function bytes(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function readKey(row: Record<string, unknown>, key: Buffer | null): { apiKey: string | null; keyState: AiKeyState } {
  if (row.ciphertext === null || row.ciphertext === undefined) return { apiKey: null, keyState: 'none' };
  if (!key || String(row.key_id) !== keyId(key)) return { apiKey: null, keyState: 'needs_reentry' };
  try {
    const plain = decryptJson<{ apiKey?: unknown }>(
      { ciphertext: bytes(row.ciphertext), iv: bytes(row.iv), authTag: bytes(row.auth_tag) },
      key
    );
    if (typeof plain?.apiKey !== 'string' || !plain.apiKey) return { apiKey: null, keyState: 'needs_reentry' };
    return { apiKey: plain.apiKey, keyState: 'ok' };
  } catch {
    return { apiKey: null, keyState: 'needs_reentry' };
  }
}

/** One row through the key. Never throws on a key mismatch or a bad key. */
export function toProvider(row: Record<string, unknown>, key: Buffer | null): AiProviderRecord | null {
  const kind = String(row.kind) as AiProviderKind;
  if (!AI_PROVIDER_KINDS.includes(kind)) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    kind,
    baseUrl: String(row.base_url),
    ...readKey(row, key),
    updatedAt: iso(row.updated_at),
    revision: Number(row.revision),
  };
}

export function toAssignment(row: Record<string, unknown>): AiAssignment | null {
  const use = String(row.use) as AiUse;
  if (!AI_USES.includes(use)) return null;
  const rawOptions = typeof row.options === 'string' ? safeJson(row.options) : row.options;
  return {
    use,
    providerId: String(row.provider_id),
    model: String(row.model),
    options: parseOptions(use, rawOptions),
    updatedAt: iso(row.updated_at),
    revision: Number(row.revision),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ── Providers ───────────────────────────────────────────

export async function listProviders(client: PoolLike, userId: string, key: Buffer | null): Promise<AiProviderRecord[]> {
  const result = await client.query(
    `SELECT ${PROVIDER_COLUMNS} FROM ai_providers WHERE user_id = $1 ORDER BY created_at, name`,
    [userId]
  );
  return result.rows.map(row => toProvider(row, key)).filter((p): p is AiProviderRecord => p !== null);
}

export async function getProvider(
  client: PoolLike,
  userId: string,
  id: string,
  key: Buffer | null
): Promise<AiProviderRecord | null> {
  const result = await client.query(`SELECT ${PROVIDER_COLUMNS} FROM ai_providers WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return result.rows[0] ? toProvider(result.rows[0], key) : null;
}

export interface ProviderWrite {
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  /** The key to store, or null to store none. */
  apiKey: string | null;
}

function keyParams(apiKey: string | null, key: Buffer | null): [Buffer | null, Buffer | null, Buffer | null, string | null] {
  if (apiKey === null) return [null, null, null, null];
  if (!key) throw new Error('No valid VITAL_SECRET_KEY is configured; the API key cannot be stored.');
  const parts = encryptJson({ apiKey }, key);
  return [parts.ciphertext, parts.iv, parts.authTag, keyId(key)];
}

/** Insert a provider. Throws a unique violation (code 23505) when the user already has one by that name. */
export async function insertProvider(
  client: PoolLike,
  userId: string,
  id: string,
  value: ProviderWrite,
  key: Buffer | null
): Promise<void> {
  await client.query(
    `INSERT INTO ai_providers (id, user_id, name, kind, base_url, ciphertext, iv, auth_tag, key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, value.name, value.kind, value.baseUrl, ...keyParams(value.apiKey, key)]
  );
}

/** Replace a provider's fields and key. Returns false when the user has no provider with that id. */
export async function updateProvider(
  client: PoolLike,
  userId: string,
  id: string,
  value: ProviderWrite,
  key: Buffer | null
): Promise<boolean> {
  const result = await client.query(
    `UPDATE ai_providers
        SET name = $3, kind = $4, base_url = $5, ciphertext = $6, iv = $7, auth_tag = $8, key_id = $9,
            updated_at = now(), revision = revision + 1
      WHERE id = $1 AND user_id = $2
  RETURNING id`,
    [id, userId, value.name, value.kind, value.baseUrl, ...keyParams(value.apiKey, key)]
  );
  return result.rows.length > 0;
}

/** Delete a provider, and with it every assignment that names it. Returns whether a row was removed. */
export async function deleteProvider(client: PoolLike, userId: string, id: string): Promise<boolean> {
  const result = await client.query('DELETE FROM ai_providers WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  return result.rows.length > 0;
}

// ── Assignments ─────────────────────────────────────────

export async function listAssignments(client: PoolLike, userId: string): Promise<AiAssignment[]> {
  const result = await client.query(`SELECT ${ASSIGNMENT_COLUMNS} FROM ai_assignments WHERE user_id = $1`, [userId]);
  return result.rows.map(toAssignment).filter((a): a is AiAssignment => a !== null);
}

export interface AssignmentWrite {
  providerId: string;
  model: string;
  options: AiOptions;
}

/**
 * Set one use. The foreign key refuses a provider that is not the same user's
 * (code 23503), so a choice can never point across users.
 */
export async function putAssignment(
  client: PoolLike,
  userId: string,
  use: AiUse,
  value: AssignmentWrite
): Promise<void> {
  await client.query(
    `INSERT INTO ai_assignments (user_id, use, provider_id, model, options)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (user_id, use) DO UPDATE
        SET provider_id = EXCLUDED.provider_id,
            model = EXCLUDED.model,
            options = EXCLUDED.options,
            updated_at = now(),
            revision = ai_assignments.revision + 1`,
    [userId, use, value.providerId, value.model, JSON.stringify(value.options)]
  );
}

/** Clear one use. Returns whether a row was removed. */
export async function deleteAssignment(client: PoolLike, userId: string, use: AiUse): Promise<boolean> {
  const result = await client.query('DELETE FROM ai_assignments WHERE user_id = $1 AND use = $2 RETURNING use', [
    userId,
    use,
  ]);
  return result.rows.length > 0;
}

/** Whether an error is Postgres's unique violation. */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505');
}

/** Whether an error is Postgres's foreign-key violation. */
export function isForeignKeyViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23503');
}
