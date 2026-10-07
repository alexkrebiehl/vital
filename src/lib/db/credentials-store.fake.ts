// ── In-memory stand-in for the source_credentials table (TESTS ONLY) ─────────
//
// Understands only the statements the credentials store sends, keeps rows in
// memory and records every statement. It is not imported by application code.

import type { PoolLike } from './pool';

type Row = Record<string, unknown>;

/**
 * A stand-in for the one table: it understands only the statements this store
 * sends, keeps rows in memory and records every statement. It is NOT Postgres:
 * the real SQL is exercised by the migration and by the manual smoke test.
 */
export function fakeTable(): PoolLike & {
  rows: Map<string, Row>;
  sent: { text: string; params?: unknown[] }[];
  /** Source ids whose removal marker was written (`data_sources_seen.removed_at`). */
  marked: Set<string>;
  /** When set, writing a removal marker throws it. */
  markerError: Error | null;
} {
  const rows = new Map<string, Row>();
  const sent: { text: string; params?: unknown[] }[] = [];
  const marked = new Set<string>();
  const self = {
    rows,
    sent,
    marked,
    markerError: null as Error | null,
    async query(text: string, params: unknown[] = []) {
      sent.push({ text, params });
      const sql = text.replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.startsWith('INSERT INTO source_credentials')) {
        const [id, ciphertext, iv, auth_tag, key_id, scopes, access_expires_at] = params as [
          string, Buffer, Buffer, Buffer, string, string, string
        ];
        const prior = rows.get(id);
        rows.set(id, {
          source_id: id,
          ciphertext,
          iv,
          auth_tag,
          key_id,
          scopes,
          access_expires_at,
          connected_at: prior?.connected_at ?? '2026-10-04T10:00:00Z',
          updated_at: '2026-10-04T10:05:00Z',
          revision: prior ? Number(prior.revision) + 1 : 1,
        });
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO data_sources_seen (source_id, removed_at)')) {
        if (self.markerError) throw self.markerError;
        for (const id of params[0] as string[]) marked.add(id);
        return { rows: [] };
      }
      if (sql.startsWith('SELECT 1 AS present')) {
        return { rows: rows.has(String(params[0])) ? [{ present: 1 }] : [] };
      }
      if (sql.startsWith('SELECT source_id')) {
        const row = rows.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('DELETE FROM source_credentials')) {
        const had = rows.delete(String(params[0]));
        return { rows: had ? [{ source_id: params[0] }] : [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return self;
}
