// ── Source lifecycle: detect removal and hide at once (SERVER ONLY) ─────────
//
// Plan §C4. `data_sources_seen` records, for every source ever active, when it
// was first and last active and when it was found removed (NULL while active).
// A source that was seen before but is not active now gets `removed_at`; from
// that moment every conversation tagged with it is hidden (db/analyst-store
// filters on it in every read) and the clock for the hard purge starts
// (sources/purge-store). A source that comes back clears `removed_at`, so the
// hidden conversations are visible again.
//
// TAGS ONLY: this table holds source ids and timestamps, never a value.
//
// Called at boot (instrumentation-node) and by `reconcileActiveSources()`
// whenever the active set changes.

import { getPool, type PoolLike } from '@/lib/db/pool';
import { withTransaction } from '@/lib/db/lab-store';
import { purgeDueSources, purgeGraceDays } from './purge-store';

const UPSERT_ACTIVE = `
  INSERT INTO data_sources_seen (source_id)
  SELECT unnest($1::text[])
  ON CONFLICT (source_id) DO UPDATE
    SET last_active_at = now(),
        removed_at     = NULL
`;

const MARK_REMOVED = `
  UPDATE data_sources_seen
     SET removed_at = now()
   WHERE removed_at IS NULL
     AND NOT (source_id = ANY($1::text[]))
  RETURNING source_id
`;

export interface LifecycleChange {
  /** Sources found removed by this pass (their `removed_at` was NULL). */
  removed: string[];
}

/**
 * Record the active set: stamp the active sources, clear any removal on a
 * source that is back, and mark every other known source removed (once).
 */
export async function recordActiveSources(client: PoolLike, activeIds: string[]): Promise<LifecycleChange> {
  const ids = [...new Set(activeIds)].sort();
  return withTransaction(client, async tx => {
    await tx.query(UPSERT_ACTIVE, [ids]);
    const result = await tx.query(MARK_REMOVED, [ids]);
    return { removed: result.rows.map(row => String(row.source_id)).sort() };
  });
}

/**
 * Bring the stored lifecycle in line with the active set, then purge whatever
 * is past its grace period. Does nothing when no database is configured (there
 * is nothing stored to hide). Throws on a database error so the caller can retry.
 */
export async function syncLifecycle(
  activeIds: string[],
  env: NodeJS.ProcessEnv = process.env,
  clientFor: (env: NodeJS.ProcessEnv) => PoolLike | null = getPool
): Promise<LifecycleChange | null> {
  const client = clientFor(env);
  if (!client) return null;
  const change = await recordActiveSources(client, activeIds);
  await purgeDueSources(client, purgeGraceDays(env));
  return change;
}
