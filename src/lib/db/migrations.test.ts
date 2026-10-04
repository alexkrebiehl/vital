// ── The shipped migrations ──────────────────────────────────────────────────
//
// The runner refuses two files with the same version, and the container
// entrypoint refuses to start when the runner fails. A clash can arrive through
// a merge (two branches each adding "the next" number), so the real
// db/migrations directory is checked here rather than only at deploy time.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrations } from './migrate-core.mjs';

const DIR = join(process.cwd(), 'db', 'migrations');

function shipped() {
  return readdirSync(DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(filename => ({ filename, sql: readFileSync(join(DIR, filename), 'utf8') }));
}

describe('db/migrations', () => {
  it('builds: every version is claimed by exactly one file', () => {
    expect(() => buildMigrations(shipped())).not.toThrow();
  });

  it('ships 0010 source credentials, with no health-value column', () => {
    const file = shipped().find(m => m.filename === '0010-source-credentials.sql');
    expect(file).toBeDefined();
    const columns = [...file!.sql.matchAll(/^\s{2}(\w+)\s+(?:text|bytea|timestamptz|integer)\b/gm)].map(m => m[1]);
    expect(columns).toEqual([
      'source_id',
      'ciphertext',
      'iv',
      'auth_tag',
      'key_id',
      'scopes',
      'access_expires_at',
      'connected_at',
      'updated_at',
      'revision',
    ]);
  });

  it('ships 0011 source tags: ids only, no health value, and a backfill that cannot re-tag', () => {
    const file = shipped().find(m => m.filename === '0011-source-provenance.sql');
    expect(file).toBeDefined();
    const sql = file!.sql;
    expect(sql).toMatch(/ALTER TABLE analyst_messages\s+ADD COLUMN IF NOT EXISTS source_ids text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/ALTER TABLE analyst_conversations\s+ADD COLUMN IF NOT EXISTS source_ids text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/USING gin \(source_ids\)/);
    const columns = [...sql.match(/CREATE TABLE IF NOT EXISTS data_sources_seen \(([\s\S]*?)\n\);/)![1].matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1]);
    expect(columns).toEqual(['source_id', 'first_active_at', 'last_active_at', 'removed_at']);
    // Both backfills touch only untagged rows.
    expect([...sql.matchAll(/WHERE (?:c\.)?source_ids = '\{\}'::text\[\]/g)]).toHaveLength(2);
  });

  it('numbers each file as its header says', () => {
    for (const { filename, sql } of shipped()) {
      const version = filename.slice(0, 4);
      expect(sql.split('\n')[0], filename).toContain(`── ${version} —`);
    }
  });
});
