// ── Users store: Postgres (SERVER ONLY) ──────────────────
//
// One `users` row per declared profile (db/migrations/0010-users.sql). Every
// per-person table carries `user_id` referencing it. The row's id is a UUID that
// never changes, so a later identity provider can attach an external subject
// (`external_issuer`, `external_subject`) to the same person without moving any
// data.
//
// The profiles themselves are declared in the environment (VITAL_PROFILES), so
// this store only makes sure each declared slug has a row:
//
//   * a slug with a row               → that row;
//   * a slug without one              → a new row;
//   * the PRIMARY slug without a row,
//     while the legacy `owner` row
//     exists and is not itself declared → `owner` is RENAMED to the primary
//                                         slug, so everything stored before
//                                         profiles existed becomes the primary
//                                         person's.
//
// The result is memoized per declared list on `globalThis` (one answer for every
// server bundle). A failure is not memoized, so the next request retries.

import type { DeclaredProfile } from '@/lib/identity/profiles';
import { DEFAULT_PROFILE_SLUG } from '@/lib/identity/profiles';
import { NO_DATABASE_CONFIGURED_REASON } from './backend';
import { getPool, type PoolLike } from './pool';

const MEMO_KEY = Symbol.for('vital.users.memo');

interface Memo {
  key: string;
  ids: Promise<Map<string, string>>;
}

function memo(): { current: Memo | null } {
  const g = globalThis as typeof globalThis & { [MEMO_KEY]?: { current: Memo | null } };
  if (!g[MEMO_KEY]) g[MEMO_KEY] = { current: null };
  return g[MEMO_KEY];
}

/** Test seam: forget the resolved ids. */
export function resetUsersMemoForTests(): void {
  memo().current = null;
}

/** Ensure every declared profile has a `users` row; returns slug → id. */
export async function syncUsers(client: PoolLike, profiles: DeclaredProfile[]): Promise<Map<string, string>> {
  const slugs = profiles.map(p => p.slug);
  const primary = profiles.find(p => p.primary)?.slug ?? slugs[0];
  if (primary && primary !== DEFAULT_PROFILE_SLUG && !slugs.includes(DEFAULT_PROFILE_SLUG)) {
    // Adopt the pre-profiles data for the primary person, once.
    await client.query(
      `UPDATE users SET slug = $1
        WHERE slug = $2
          AND NOT EXISTS (SELECT 1 FROM users WHERE slug = $1)`,
      [primary, DEFAULT_PROFILE_SLUG]
    );
  }
  await client.query(
    `INSERT INTO users (slug) SELECT unnest($1::text[]) ON CONFLICT (slug) DO NOTHING`,
    [slugs]
  );
  const result = await client.query(`SELECT id, slug FROM users WHERE slug = ANY($1::text[])`, [slugs]);
  const ids = new Map<string, string>();
  for (const row of result.rows) ids.set(String(row.slug), String(row.id));
  return ids;
}

/** slug → users.id for the declared profiles, resolved once per process. */
export async function resolveUserIds(
  profiles: DeclaredProfile[],
  env: NodeJS.ProcessEnv = process.env
): Promise<Map<string, string>> {
  const key = profiles.map(p => p.slug).join(',');
  const m = memo();
  if (m.current && m.current.key === key) return m.current.ids;
  const pool = getPool(env);
  if (!pool) throw new Error(NO_DATABASE_CONFIGURED_REASON);
  const ids = syncUsers(pool, profiles);
  m.current = { key, ids };
  ids.catch(() => {
    if (m.current?.ids === ids) m.current = null;
  });
  return ids;
}
