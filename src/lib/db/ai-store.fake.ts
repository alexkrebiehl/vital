// ── In-memory stand-in for the AI tables (TESTS ONLY) ────
//
// Understands only the statements `./ai-store` sends, with the semantics of
// db/migrations/0017 that the store relies on: rows filtered by user, a unique
// name per user, an assignment that may only name the same user's provider
// (Postgres code 23503 otherwise), and ON DELETE CASCADE from a provider to its
// assignments. It is NOT Postgres: the real SQL is exercised against a database
// in the manual check. Imported only by *.test.ts files.

import type { PoolLike } from './pool';

type Row = Record<string, unknown>;

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function fakeAiTables(): PoolLike & {
  providers: Map<string, Row>;
  assignments: Map<string, Row>;
  sent: { text: string; params: unknown[] }[];
  /** When set, the next statement throws it. */
  failNext: Error | null;
} {
  const providers = new Map<string, Row>();
  const assignments = new Map<string, Row>();
  const sent: { text: string; params: unknown[] }[] = [];
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 11, 0, 0, ++clock)).toISOString();
  const assignmentKey = (user: unknown, use: unknown) => `${user}|${use}`;

  const self = {
    providers,
    assignments,
    sent,
    failNext: null as Error | null,
    async query(text: string, params: unknown[] = []) {
      sent.push({ text, params });
      if (self.failNext) {
        const error = self.failNext;
        self.failNext = null;
        throw error;
      }
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.startsWith('SELECT id, name, kind, base_url') && sql.includes('WHERE user_id = $1 ORDER BY')) {
        const rows = [...providers.values()].filter(r => r.user_id === params[0]);
        return { rows: rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) };
      }
      if (sql.startsWith('SELECT id, name, kind, base_url') && sql.includes('WHERE id = $1 AND user_id = $2')) {
        const row = providers.get(String(params[0]));
        return { rows: row && row.user_id === params[1] ? [row] : [] };
      }
      if (sql.startsWith('INSERT INTO ai_providers')) {
        const [id, user_id, name, kind, base_url, ciphertext, iv, auth_tag, key_id] = params;
        if ([...providers.values()].some(r => r.user_id === user_id && r.name === name)) throw pgError('23505', 'duplicate name');
        const at = stamp();
        providers.set(String(id), { id, user_id, name, kind, base_url, ciphertext, iv, auth_tag, key_id, created_at: at, updated_at: at, revision: 1 });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE ai_providers')) {
        const [id, user_id, name, kind, base_url, ciphertext, iv, auth_tag, key_id] = params;
        const row = providers.get(String(id));
        if (!row || row.user_id !== user_id) return { rows: [] };
        if ([...providers.values()].some(r => r.id !== id && r.user_id === user_id && r.name === name)) throw pgError('23505', 'duplicate name');
        Object.assign(row, { name, kind, base_url, ciphertext, iv, auth_tag, key_id, updated_at: stamp(), revision: Number(row.revision) + 1 });
        return { rows: [{ id }] };
      }
      if (sql.startsWith('DELETE FROM ai_providers')) {
        const row = providers.get(String(params[0]));
        if (!row || row.user_id !== params[1]) return { rows: [] };
        providers.delete(String(params[0]));
        for (const [key, a] of assignments) if (a.provider_id === params[0] && a.user_id === params[1]) assignments.delete(key);
        return { rows: [{ id: params[0] }] };
      }
      if (sql.startsWith('SELECT use, provider_id, model, options')) {
        return { rows: [...assignments.values()].filter(r => r.user_id === params[0]) };
      }
      if (sql.startsWith('INSERT INTO ai_assignments')) {
        const [user_id, use, provider_id, model, options] = params;
        const provider = providers.get(String(provider_id));
        if (!provider || provider.user_id !== user_id) throw pgError('23503', 'foreign key');
        const key = assignmentKey(user_id, use);
        const prior = assignments.get(key);
        assignments.set(key, {
          user_id,
          use,
          provider_id,
          model,
          options: JSON.parse(String(options)),
          updated_at: stamp(),
          revision: prior ? Number(prior.revision) + 1 : 1,
        });
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM ai_assignments')) {
        const key = assignmentKey(params[0], params[1]);
        const had = assignments.delete(key);
        return { rows: had ? [{ use: params[1] }] : [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return self;
}
