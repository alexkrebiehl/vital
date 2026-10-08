// ── Dashboard cards store: Postgres (SERVER ONLY) ────────────────────────────
//
// The cards on the Dashboard page (db/migrations/0015). Every pg* function takes
// its client, so the SQL runs against an injected stand-in in the offline
// tests; the API routes pass the process pool.
//
// CONFIGURATION ONLY: an id, a mode, a type, a spec (a metric id and day keys),
// a layout and timestamps. There is no column for a reading or any other
// value; values are computed in the browser.
//
// Every query is scoped by `mode`, which the SERVER takes from the data mode.
// Rows come back through `readStoredCard`, so a row this version cannot read is
// served as unreadable instead of being dropped.
//
// An edit or delete names the revision it was based on. Create and reorder are
// each ONE statement, so they are atomic without a transaction client.
// See docs/design/dashboard.md §3 and §7.3.

import { randomUUID } from 'crypto';
import { readStoredCard } from '@/lib/dashboard/card-schemas';
import { MAX_CARDS_PER_MODE, type CardRecord, type CardSize, type DashboardMode } from '@/lib/dashboard/types';
import { getPool, type PoolLike } from './pool';

export const DASHBOARD_COLUMNS = 'id, card_type, spec, schema_version, position, width, height, revision, created_at, updated_at';

export class CardConflictError extends Error {
  /** The card as it is now, when the conflict is a stale revision. */
  readonly card?: CardRecord;
  constructor(message: string, card?: CardRecord) {
    super(message);
    this.name = 'CardConflictError';
    this.card = card;
  }
}

export class CardNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardNotFoundError';
  }
}

export interface NewCard {
  type: string;
  spec: unknown;
  schemaVersion: number;
  size: CardSize;
}
export interface CardEdit {
  spec: unknown;
  schemaVersion: number;
  size: CardSize;
}

const toCard = (row: Record<string, unknown>) =>
  readStoredCard(row as unknown as Parameters<typeof readStoredCard>[0]);

/** In order. Rows this version cannot read are returned as `unreadable`. */
export async function pgListCards(client: PoolLike, mode: DashboardMode): Promise<CardRecord[]> {
  const result = await client.query(
    `SELECT ${DASHBOARD_COLUMNS} FROM dashboard_cards WHERE mode = $1 ORDER BY position, id`,
    [mode]
  );
  return result.rows.map(toCard);
}

/** One card of this mode, or null (another mode's card is not found). */
export async function pgReadCard(client: PoolLike, mode: DashboardMode, id: string): Promise<CardRecord | null> {
  const result = await client.query(
    `SELECT ${DASHBOARD_COLUMNS} FROM dashboard_cards WHERE id = $1 AND mode = $2`,
    [id, mode]
  );
  return result.rows[0] ? toCard(result.rows[0]) : null;
}

const CAP_MESSAGE = `At most ${MAX_CARDS_PER_MODE} cards can be kept.`;

/** Append a card at the end. One statement; at the cap it inserts nothing. */
export async function pgCreateCard(client: PoolLike, mode: DashboardMode, input: NewCard): Promise<CardRecord> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await client.query(
        `INSERT INTO dashboard_cards (id, mode, card_type, spec, schema_version, position, width, height)
         SELECT $1, $2, $3, $4::jsonb, $5,
                (SELECT coalesce(max(position) + 1, 0) FROM dashboard_cards WHERE mode = $2), $6, $7
          WHERE (SELECT count(*) FROM dashboard_cards WHERE mode = $2) < $8
         RETURNING ${DASHBOARD_COLUMNS}`,
        [`card-${randomUUID()}`, mode, input.type, JSON.stringify(input.spec), input.schemaVersion, input.size.w, input.size.h, MAX_CARDS_PER_MODE]
      );
      if (!result.rows[0]) throw new CardConflictError(CAP_MESSAGE);
      return toCard(result.rows[0]);
    } catch (err) {
      // Two creates took the same position: the unique constraint refused one.
      if ((err as { code?: string }).code === '23505' && attempt === 0) continue;
      if ((err as { code?: string }).code === '23505') {
        throw new CardConflictError('Cards were added at the same moment; try again.');
      }
      throw err;
    }
  }
  throw new CardConflictError('Cards were added at the same moment; try again.');
}

/** After a refused edit or delete: not found, or stale (carrying the card as it is now). */
async function explainMiss(client: PoolLike, mode: DashboardMode, id: string, revision: number): Promise<never> {
  const current = await pgReadCard(client, mode, id);
  if (!current) throw new CardNotFoundError(`No card ${id}.`);
  throw new CardConflictError(`Card ${id} was changed elsewhere (revision ${current.revision}, not ${revision}).`, current);
}

export async function pgReplaceCard(
  client: PoolLike,
  mode: DashboardMode,
  id: string,
  edit: CardEdit,
  revision: number
): Promise<CardRecord> {
  const result = await client.query(
    `UPDATE dashboard_cards
        SET spec = $4::jsonb, schema_version = $5, width = $6, height = $7, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND mode = $2 AND revision = $3
      RETURNING ${DASHBOARD_COLUMNS}`,
    [id, mode, revision, JSON.stringify(edit.spec), edit.schemaVersion, edit.size.w, edit.size.h]
  );
  if (result.rows[0]) return toCard(result.rows[0]);
  return explainMiss(client, mode, id, revision);
}

export async function pgDeleteCard(client: PoolLike, mode: DashboardMode, id: string, revision: number): Promise<void> {
  const result = await client.query(
    'DELETE FROM dashboard_cards WHERE id = $1 AND mode = $2 AND revision = $3 RETURNING id',
    [id, mode, revision]
  );
  if (result.rows[0]) return;
  await explainMiss(client, mode, id, revision);
}

const ORDER_MESSAGE = 'The order must name every card exactly once; reload and try again.';

/**
 * Put the cards in this order. The list must name every card of the mode
 * exactly once; otherwise nothing changes. One statement, so it is atomic
 * (the deferrable unique on (mode, position) lets it permute positions).
 * Revisions are not bumped: a reorder must not make an open edit stale.
 */
export async function pgReorderCards(client: PoolLike, mode: DashboardMode, ids: string[]): Promise<CardRecord[]> {
  const result = await client.query(
    `WITH wanted AS (
       SELECT o.id, (o.ord - 1)::int AS position
         FROM unnest($2::text[]) WITH ORDINALITY AS o(id, ord)
     ), cur AS (
       SELECT id FROM dashboard_cards WHERE mode = $1
     ), ok AS (
       SELECT (SELECT count(*) FROM cur) = cardinality($2::text[])
          AND (SELECT count(DISTINCT id) FROM wanted) = cardinality($2::text[])
          AND NOT EXISTS (SELECT 1 FROM wanted w LEFT JOIN cur c USING (id) WHERE c.id IS NULL) AS valid
     )
     UPDATE dashboard_cards d
        SET position = w.position, updated_at = now()
       FROM wanted w, ok
      WHERE d.mode = $1 AND d.id = w.id AND ok.valid
     RETURNING d.id`,
    [mode, ids]
  );
  if (result.rows.length !== ids.length) throw new CardConflictError(ORDER_MESSAGE);
  const cards = await pgListCards(client, mode);
  // An empty list "matches" zero updated rows whatever the mode holds.
  if (ids.length === 0 && cards.length > 0) throw new CardConflictError(ORDER_MESSAGE);
  return cards;
}

// ── Process-wide wrappers ───────────────────────────────

/** Null when no database is configured (the routes answer 503). */
export function dashboardClient(env: NodeJS.ProcessEnv = process.env): PoolLike | null {
  return getPool(env) as unknown as PoolLike | null;
}
