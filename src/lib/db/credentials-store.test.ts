import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deleteCredential,
  getCredential,
  hasCredentialRow,
  putCredential,
  withLockedCredential,
} from './credentials-store';
import { fakeTable } from './credentials-store.fake';

const key = () => randomBytes(32);
const tokens = { accessToken: 'sample-access-token-value', refreshToken: 'sample-refresh-token-value' };
const expires = new Date('2026-10-04T11:00:00Z');

describe('credentials store', () => {
  it('round-trips tokens, scopes and expiry', async () => {
    const db = fakeTable();
    const k = key();
    await putCredential(db, 'oura', tokens, ['daily', 'heartrate'], expires, k);
    const got = await getCredential(db, 'oura', k);
    expect(got).toMatchObject({
      needsReconnect: false,
      sourceId: 'oura',
      tokens,
      scopes: ['daily', 'heartrate'],
      revision: 1,
    });
    expect((got as { accessExpiresAt: Date }).accessExpiresAt.toISOString()).toBe(expires.toISOString());
  });

  it('returns null when nothing is stored', async () => {
    expect(await getCredential(fakeTable(), 'oura', key())).toBeNull();
  });

  it('bumps the revision on every write', async () => {
    const db = fakeTable();
    const k = key();
    await putCredential(db, 'oura', tokens, [], expires, k);
    await putCredential(db, 'oura', { ...tokens, refreshToken: 'sample-next' }, [], expires, k);
    const got = await getCredential(db, 'oura', k);
    expect(got).toMatchObject({ revision: 2, tokens: { refreshToken: 'sample-next' } });
  });

  it('reports needsReconnect for a different key, and does not throw', async () => {
    const db = fakeTable();
    await putCredential(db, 'oura', tokens, [], expires, key());
    expect(await getCredential(db, 'oura', key())).toEqual({ needsReconnect: true, sourceId: 'oura' });
  });

  it('reports needsReconnect when no key is configured', async () => {
    const db = fakeTable();
    await putCredential(db, 'oura', tokens, [], expires, key());
    expect(await getCredential(db, 'oura', null)).toEqual({ needsReconnect: true, sourceId: 'oura' });
  });

  it('reports needsReconnect for a row that fails to decrypt (key id matches)', async () => {
    const db = fakeTable();
    const k = key();
    await putCredential(db, 'oura', tokens, [], expires, k);
    const row = db.rows.get('oura')!;
    const bad = Buffer.from(row.auth_tag as Buffer);
    bad[0] ^= 1;
    db.rows.set('oura', { ...row, auth_tag: bad });
    expect(await getCredential(db, 'oura', k)).toEqual({ needsReconnect: true, sourceId: 'oura' });
  });

  it('refuses to store without a key', async () => {
    await expect(putCredential(fakeTable(), 'oura', tokens, [], expires, null)).rejects.toThrow(/VITAL_SECRET_KEY/);
  });

  it('deleting leaves nothing', async () => {
    const db = fakeTable();
    const k = key();
    await putCredential(db, 'oura', tokens, [], expires, k);
    expect(await hasCredentialRow(db, 'oura')).toBe(true);
    expect(await deleteCredential(db, 'oura')).toBe(true);
    expect(await getCredential(db, 'oura', k)).toBeNull();
    expect(await hasCredentialRow(db, 'oura')).toBe(false);
    expect(db.rows.size).toBe(0);
    expect(await deleteCredential(db, 'oura')).toBe(false);
  });

  it('stores no plaintext token: a byte search of every stored value and parameter finds none', async () => {
    const db = fakeTable();
    await putCredential(db, 'oura', tokens, ['daily'], expires, key());
    const row = db.rows.get('oura')!;
    for (const needle of [tokens.accessToken, tokens.refreshToken]) {
      expect((row.ciphertext as Buffer).includes(Buffer.from(needle))).toBe(false);
      for (const sent of db.sent) {
        for (const p of sent.params ?? []) {
          const hay = Buffer.isBuffer(p) ? p : Buffer.from(String(p));
          expect(hay.includes(Buffer.from(needle))).toBe(false);
        }
        expect(sent.text).not.toContain(needle);
      }
    }
  });

  describe('withLockedCredential', () => {
    it('reads FOR UPDATE inside BEGIN/COMMIT and writes through the same transaction', async () => {
      const db = fakeTable();
      const k = key();
      await putCredential(db, 'oura', tokens, ['daily'], expires, k);
      db.sent.length = 0;
      const seen = await withLockedCredential(db, 'oura', k, async locked => {
        expect(locked.current).toMatchObject({ needsReconnect: false, tokens });
        await locked.put({ accessToken: 'sample-a2', refreshToken: 'sample-r2' }, ['daily'], expires);
        return 'done';
      });
      expect(seen).toBe('done');
      const texts = db.sent.map(s => s.text.replace(/\s+/g, ' ').trim());
      expect(texts[0]).toBe('BEGIN');
      expect(texts[1]).toMatch(/FOR UPDATE$/);
      expect(texts[2]).toMatch(/^INSERT INTO source_credentials/);
      expect(texts[3]).toBe('COMMIT');
      expect(await getCredential(db, 'oura', k)).toMatchObject({ tokens: { refreshToken: 'sample-r2' }, revision: 2 });
    });

    it('hands over null when there is no row, and can delete', async () => {
      const db = fakeTable();
      const k = key();
      expect(await withLockedCredential(db, 'oura', k, async l => l.current)).toBeNull();
      await putCredential(db, 'oura', tokens, [], expires, k);
      expect(await withLockedCredential(db, 'oura', k, l => l.delete())).toBe(true);
      expect(db.rows.size).toBe(0);
    });

    it('rolls back and rethrows when fn throws', async () => {
      const db = fakeTable();
      await expect(
        withLockedCredential(db, 'oura', key(), async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(db.sent.map(s => s.text).at(-1)).toBe('ROLLBACK');
    });
  });
});

describe('bareScope', () => {
  it('strips the extapi: namespace and leaves bare names alone', async () => {
    const { bareScope } = await import('./credentials-store');
    expect(bareScope('extapi:daily')).toBe('daily');
    expect(bareScope('spo2')).toBe('spo2');
  });
});
