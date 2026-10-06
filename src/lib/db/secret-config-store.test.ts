import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCredential, getSecretConfig, putSecretConfig, deleteCredential } from './credentials-store';
import { fakeTable } from './credentials-store.fake';

const key = () => randomBytes(32);
const values = { endpoint: 'http://sample-host.invalid:3001', apiKey: 'sample-api-key-value-1234' };

describe('secret config store', () => {
  it('round-trips the fields', async () => {
    const db = fakeTable();
    const k = key();
    await putSecretConfig(db, 'hae', values, k);
    expect(await getSecretConfig(db, 'hae', k)).toMatchObject({ needsReentry: false, values });
  });

  it('keeps the plaintext out of the stored row', async () => {
    const db = fakeTable();
    await putSecretConfig(db, 'hae', values, key());
    const row = db.rows.get('hae')!;
    expect(Buffer.from(row.ciphertext as Buffer).toString('utf8')).not.toContain('sample-api-key');
    expect(JSON.stringify(db.sent.map(s => s.text))).not.toContain('sample-api-key');
    expect(row.scopes).toBe('');
    expect(row.access_expires_at).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    expect(await getSecretConfig(fakeTable(), 'hae', key())).toBeNull();
  });

  it('reads as needsReentry for another key, no key, or a corrupt row; never throws', async () => {
    const db = fakeTable();
    const k = key();
    await putSecretConfig(db, 'hae', values, k);
    const want = { needsReentry: true, sourceId: 'hae' };
    expect(await getSecretConfig(db, 'hae', key())).toEqual(want);
    expect(await getSecretConfig(db, 'hae', null)).toEqual(want);
    const row = db.rows.get('hae')!;
    row.auth_tag = Buffer.alloc(16);
    expect(await getSecretConfig(db, 'hae', k)).toEqual(want);
  });

  it('a stored secret config is not an OAuth credential', async () => {
    const db = fakeTable();
    const k = key();
    await putSecretConfig(db, 'hae', values, k);
    expect(await getCredential(db, 'hae', k)).toEqual({ needsReconnect: true, sourceId: 'hae' });
  });

  it('refuses to store without a key', async () => {
    await expect(putSecretConfig(fakeTable(), 'hae', values, null)).rejects.toThrow(/VITAL_SECRET_KEY/);
  });

  it('deletes', async () => {
    const db = fakeTable();
    const k = key();
    await putSecretConfig(db, 'hae', values, k);
    expect(await deleteCredential(db, 'hae')).toBe(true);
    expect(await getSecretConfig(db, 'hae', k)).toBeNull();
  });

  it('migration 0013 makes the expiry nullable and touches nothing else', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/0013-source-credentials-secret-config.sql'), 'utf8');
    const stmts = sql.split('\n').filter(l => !l.trim().startsWith('--') && l.trim());
    expect(stmts).toEqual(['ALTER TABLE source_credentials ALTER COLUMN access_expires_at DROP NOT NULL;']);
  });
});
