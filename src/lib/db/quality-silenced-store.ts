// ── Silenced data-quality findings: Postgres (SERVER ONLY) ───────────────────
//
// The `quality_silenced` table (db/migrations/0014). CONFIGURATION ONLY: a check
// id and, for a per-metric check, a metric id. It never holds a record, a day
// range or a value. Every pg* function takes its client, so the SQL runs against
// an injected stand-in in the offline tests.
//
// Silencing and restoring are idempotent: a second silence keeps one row, and
// restoring something that is not silenced is not an error.

import { QUALITY_CHECK_IDS, type SilencedKey } from '@/lib/adapters/quality-silenced';
import type { QualityCheckId } from '@/lib/adapters/quality';
import { NO_DATABASE_CONFIGURED_REASON } from './backend';
import { getPool, type PoolLike } from './pool';

/** Oldest first. A row whose check id is no longer known is dropped, not served. */
export async function pgReadSilenced(client: PoolLike): Promise<SilencedKey[]> {
  const result = await client.query('SELECT check_id, metric_id FROM quality_silenced ORDER BY silenced_at, check_id, metric_id');
  const known = new Set<string>(QUALITY_CHECK_IDS);
  return result.rows
    .filter(r => known.has(String(r.check_id)))
    .map(r => ({ checkId: String(r.check_id) as QualityCheckId, metricId: String(r.metric_id) }));
}

export async function pgSilence(client: PoolLike, key: SilencedKey): Promise<void> {
  await client.query(
    'INSERT INTO quality_silenced (check_id, metric_id) VALUES ($1, $2) ON CONFLICT (check_id, metric_id) DO NOTHING',
    [key.checkId, key.metricId]
  );
}

export async function pgRestore(client: PoolLike, key: SilencedKey): Promise<void> {
  await client.query('DELETE FROM quality_silenced WHERE check_id = $1 AND metric_id = $2', [key.checkId, key.metricId]);
}

// ── Process-wide wrappers ───────────────────────────────

/** Null when no database is configured (the caller decides what that means). */
export function silencedClient(env: NodeJS.ProcessEnv = process.env): PoolLike | null {
  return getPool(env) as unknown as PoolLike | null;
}

function poolOrThrow(env: NodeJS.ProcessEnv): PoolLike {
  const pool = silencedClient(env);
  if (!pool) throw new Error(NO_DATABASE_CONFIGURED_REASON);
  return pool;
}

export const readSilenced = (env: NodeJS.ProcessEnv = process.env) => pgReadSilenced(poolOrThrow(env));
export const silenceFinding = (key: SilencedKey, env: NodeJS.ProcessEnv = process.env) => pgSilence(poolOrThrow(env), key);
export const restoreFinding = (key: SilencedKey, env: NodeJS.ProcessEnv = process.env) => pgRestore(poolOrThrow(env), key);
