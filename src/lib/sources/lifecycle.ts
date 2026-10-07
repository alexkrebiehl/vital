// ── Source lifecycle: only a deliberate removal erases conversations (SERVER ONLY) ──
//
// Plan §8, v0.3.1 rule: removing a data source erases its data at once, as if it
// had never existed. Nothing is hidden, nothing waits out a grace period. But
// REMOVAL IS A DELIBERATE ACT, never just "not active right now": an upgrade, a
// restart, a failed read or a credential not yet re-entered must never erase a
// conversation.
//
// `data_sources_seen` records every source that was ever active. Its `removed_at`
// column is the explicit removal marker. `markRemoved` writes it, in the same
// request that disconnects the source (or deletes the last lab report). A source
// is then GONE only when it is NOT active AND its marker is set, and in ONE
// transaction this module:
//
//   * deletes the conversations tagged with it (their messages cascade);
//   * forgets the source (its `data_sources_seen` row).
//
// A source that is merely inactive (no marker) keeps its conversations and its
// row: the person may re-enter the credential. A source that is active again
// has its marker cleared, so a late reconcile never purges it.
//
// Everything held in memory (datasets, briefings, workout sessions, routes) is
// dropped by the purgers in sources/purge for ANY source that left the active
// set, marker or not: it holds nothing durable.
//
// 0.3.0 INSTALLS. A row left with `removed_at` set (a removal waiting out its
// grace period) is a deliberate removal: the first pass after the upgrade purges
// it at once. Rows with no marker (sources that were active through the
// environment, now inactive until re-entered in Settings) are kept.
//
// SAFETY. This is only ever called with an active set the registry could read:
// a failed credential read, a database error or an unreachable source throws
// before this module is reached (sources/purge), and any error in here rolls the
// whole pass back. A failure writing the marker fails the request. Existence
// checks only; no key is needed to decide.
//
// Kept on purpose: profile, preferences, training plans, map areas. A source's
// credential row is not touched here.
//
// TAGS ONLY: ids and counts, never a value.

import { getPool, type PoolLike } from '@/lib/db/pool';
import { withTransaction } from '@/lib/db/lab-store';
import { requestLifecycleRecord } from './purge';

/** Sources removed on purpose (marker set) that are not in `$1`, locked for the purge. */
const SELECT_GONE = `
  SELECT source_id
    FROM data_sources_seen
   WHERE NOT (source_id = ANY($1::text[]))
     AND removed_at IS NOT NULL
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

/** The explicit removal marker; the row is created when missing. Idempotent. */
const MARK_REMOVED = `
  INSERT INTO data_sources_seen (source_id, removed_at)
  SELECT unnest($1::text[]), now()
  ON CONFLICT (source_id) DO UPDATE
    SET removed_at = now()
`;

export interface LifecycleChange {
  /** Sources found gone by this pass and erased, sorted. */
  purged: string[];
  /** Conversations deleted (their messages went with them). */
  conversationsDeleted: number;
}

/**
 * Record that these sources were removed on purpose. Call it in the same request
 * that removes them, after the credential row is deleted and before the
 * reconcile. Erases nothing by itself; the next reconcile does, unless the source
 * is active again. Errors propagate: the request must fail, not half-succeed.
 */
export async function markRemoved(ids: string[], client: PoolLike): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await client.query(MARK_REMOVED, [unique]);
  // The reconcile must run the pass even if this process already saw the set.
  requestLifecycleRecord();
}

/**
 * Erase every source removed on purpose that is not in `activeIds`, then stamp
 * the active ones. One transaction: either all of it happens or none of it.
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
