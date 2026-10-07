// ── Source lifecycle: a removed source is erased in the same call (SERVER ONLY) ──
//
// Plan §8, v0.3.1 rule: removing a data source erases its data at once, as if it
// had never existed. Nothing is hidden, nothing waits out a grace period.
//
// `data_sources_seen` records every source that was ever active (first and last
// active time). A source that is in that table but not in the active set is
// GONE, and in ONE transaction this module:
//
//   * deletes the conversations tagged with it (their messages cascade);
//   * forgets the source (its `data_sources_seen` row).
//
// Everything held in memory (datasets, briefings, workout sessions, routes) is
// dropped by the purgers in sources/purge, in the same reconcile.
//
// Kept on purpose: profile, preferences, training plans, map areas. A source's
// credential row is not touched here: for an explicit disconnect it is already
// deleted, and deleting it from a stale view could wipe a connection made a
// moment later.
//
// 0.3.0 INSTALLS. The old `removed_at` column is no longer written or read. A
// row left with it set (a removal waiting out its grace period) is simply a
// source that is not active: it is purged by the first pass after the upgrade,
// then forgotten. A source that is active again has the leftover mark cleared.
//
// SAFETY. This is only ever called with an active set the registry could read:
// a failed credential read, a database error or an unreachable source throws
// before this module is reached (sources/purge), and any error in here rolls the
// whole pass back. Existence checks only; no key is needed to decide.
//
// TAGS ONLY: ids and counts, never a value.

import { getPool, type PoolLike } from '@/lib/db/pool';
import { withTransaction } from '@/lib/db/lab-store';

/** Sources ever seen that are not in `$1`, locked for the purge. */
const SELECT_GONE = `
  SELECT source_id
    FROM data_sources_seen
   WHERE NOT (source_id = ANY($1::text[]))
   ORDER BY source_id
   FOR UPDATE
`;

const DELETE_CONVERSATIONS = `DELETE FROM analyst_conversations WHERE source_ids && $1::text[] RETURNING id`;
const DELETE_SEEN = `DELETE FROM data_sources_seen WHERE source_id = ANY($1::text[])`;

const UPSERT_ACTIVE = `
  INSERT INTO data_sources_seen (source_id)
  SELECT unnest($1::text[])
  ON CONFLICT (source_id) DO UPDATE
    SET last_active_at = now(),
        removed_at     = NULL
`;

export interface LifecycleChange {
  /** Sources found gone by this pass and erased, sorted. */
  purged: string[];
  /** Conversations deleted (their messages went with them). */
  conversationsDeleted: number;
}

/**
 * Erase every known source that is not in `activeIds`, then stamp the active
 * ones. One transaction: either all of it happens or none of it.
 */
export async function recordActiveSources(client: PoolLike, activeIds: string[]): Promise<LifecycleChange> {
  const ids = [...new Set(activeIds)].sort();
  return withTransaction(client, async tx => {
    const gone = (await tx.query(SELECT_GONE, [ids])).rows.map(row => String(row.source_id));
    let conversationsDeleted = 0;
    if (gone.length > 0) {
      conversationsDeleted = (await tx.query(DELETE_CONVERSATIONS, [gone])).rows.length;
      await tx.query(DELETE_SEEN, [gone]);
    }
    await tx.query(UPSERT_ACTIVE, [ids]);
    return { purged: gone, conversationsDeleted };
  });
}

/**
 * Bring the stored lifecycle in line with the active set, erasing what left it.
 * Does nothing when no database is configured (nothing is stored). Throws on a
 * database error, with nothing erased, so the caller can retry.
 */
export async function syncLifecycle(
  activeIds: string[],
  env: NodeJS.ProcessEnv = process.env,
  clientFor: (env: NodeJS.ProcessEnv) => PoolLike | null = getPool
): Promise<LifecycleChange | null> {
  const client = clientFor(env);
  if (!client) return null;
  return recordActiveSources(client, activeIds);
}
