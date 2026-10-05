// ── Hard purge of a removed source's derived data (SERVER ONLY) ─────────────
//
// Plan §C5. Removal hides at once (sources/lifecycle). After a grace period, or
// on demand ("Delete now"), everything persisted for the source goes, in ONE
// transaction:
//
//   * the conversations tagged with it (their messages cascade);
//   * its `source_credentials` row;
//   * its `data_sources_seen` row.
//
// Only a source that is marked removed can be purged. An active source is
// refused here as well as in the route, so no caller can erase a live source.
// A conversation tagged only with other sources is never touched.
//
// Nothing here reads or returns a health value: ids, dates and counts only.

import { withTransaction } from '@/lib/db/lab-store';
import type { PoolLike } from '@/lib/db/pool';

/** Days a removed source is kept hidden before it is purged. */
export const DEFAULT_PURGE_GRACE_DAYS = 7;

/**
 * `VITAL_SOURCE_PURGE_GRACE_DAYS`: a whole number of days, default 7. `0`
 * purges at the next boot or reconcile. Anything else falls back to the default
 * (a typo must lengthen the grace period, never shorten it).
 */
export function purgeGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.VITAL_SOURCE_PURGE_GRACE_DAYS ?? '').trim();
  if (!/^\d{1,5}$/.test(raw)) return DEFAULT_PURGE_GRACE_DAYS;
  return Number(raw);
}

const SELECT_REMOVED = `
  SELECT s.source_id,
         s.removed_at,
         (SELECT count(*)::int
            FROM analyst_conversations c
           WHERE c.source_ids @> ARRAY[s.source_id]) AS hidden_conversations
    FROM data_sources_seen s
   WHERE s.removed_at IS NOT NULL
   ORDER BY s.removed_at, s.source_id
`;

const SELECT_DUE = `
  SELECT source_id
    FROM data_sources_seen
   WHERE removed_at IS NOT NULL
     AND removed_at <= now() - make_interval(days => $1::int)
   ORDER BY source_id
`;

/** Removed sources among `$1`, locked for the purge. */
const LOCK_REMOVED = `
  SELECT source_id
    FROM data_sources_seen
   WHERE removed_at IS NOT NULL
     AND source_id = ANY($1::text[])
   ORDER BY source_id
   FOR UPDATE
`;

const DELETE_CONVERSATIONS = `DELETE FROM analyst_conversations WHERE source_ids && $1::text[] RETURNING id`;
const DELETE_CREDENTIALS = `DELETE FROM source_credentials WHERE source_id = ANY($1::text[])`;
const DELETE_SEEN = `DELETE FROM data_sources_seen WHERE source_id = ANY($1::text[])`;

export interface RemovedSource {
  sourceId: string;
  /** ISO timestamp of when the removal was noticed. */
  removedAt: string;
  /** Conversations hidden because of it (they are deleted by the purge). */
  hiddenConversations: number;
}

export interface PurgeOutcome {
  /** Ids actually purged, sorted. */
  purged: string[];
  /** Conversations deleted (their messages went with them). */
  conversationsDeleted: number;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : new Date(0).toISOString();
}

/** Every removed source, oldest removal first, with the count of conversations it hides. */
export async function listRemovedSources(client: PoolLike): Promise<RemovedSource[]> {
  const result = await client.query(SELECT_REMOVED);
  return result.rows.map(row => ({
    sourceId: String(row.source_id),
    removedAt: iso(row.removed_at),
    hiddenConversations: Number(row.hidden_conversations ?? 0),
  }));
}

/**
 * Purge the given sources, in one transaction. Ids that are not marked removed
 * (active, or never seen) are skipped, not purged.
 */
export async function purgeSources(client: PoolLike, sourceIds: string[]): Promise<PurgeOutcome> {
  const ids = [...new Set(sourceIds)].sort();
  if (ids.length === 0) return { purged: [], conversationsDeleted: 0 };
  return withTransaction(client, async tx => {
    const locked = (await tx.query(LOCK_REMOVED, [ids])).rows.map(row => String(row.source_id));
    if (locked.length === 0) return { purged: [], conversationsDeleted: 0 };
    const deleted = await tx.query(DELETE_CONVERSATIONS, [locked]);
    await tx.query(DELETE_CREDENTIALS, [locked]);
    await tx.query(DELETE_SEEN, [locked]);
    return { purged: locked, conversationsDeleted: deleted.rows.length };
  });
}

/** Purge every source whose removal is older than the grace period. */
export async function purgeDueSources(client: PoolLike, graceDays: number): Promise<PurgeOutcome> {
  const due = await client.query(SELECT_DUE, [graceDays]);
  return purgeSources(
    client,
    due.rows.map(row => String(row.source_id))
  );
}
