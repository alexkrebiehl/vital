import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptJson, encryptJson, keyId, readSecretKey } from './crypto';

const key = () => randomBytes(32);
const sample = { access_token: 'sample-access', refresh_token: 'sample-refresh' };

describe('secret-key crypto', () => {
  it('round-trips an object', () => {
    const k = key();
    expect(decryptJson(encryptJson(sample, k), k)).toEqual(sample);
  });

  it('uses a 12-byte IV and a 16-byte tag, and never stores the plaintext', () => {
    const parts = encryptJson(sample, key());
    expect(parts.iv).toHaveLength(12);
    expect(parts.authTag).toHaveLength(16);
    expect(parts.ciphertext.includes(Buffer.from('sample-refresh'))).toBe(false);
  });

  it('gives different output for the same input (random IV)', () => {
    const k = key();
    const a = encryptJson(sample, k);
    const b = encryptJson(sample, k);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('throws when the ciphertext is tampered with', () => {
    const k = key();
    const parts = encryptJson(sample, k);
    const bad = Buffer.from(parts.ciphertext);
    bad[0] ^= 1;
    expect(() => decryptJson({ ...parts, ciphertext: bad }, k)).toThrow();
  });

  it('throws when the tag is tampered with', () => {
    const k = key();
    const parts = encryptJson(sample, k);
    const bad = Buffer.from(parts.authTag);
    bad[0] ^= 1;
    expect(() => decryptJson({ ...parts, authTag: bad }, k)).toThrow();
  });

  it('throws with the wrong key', () => {
    const parts = encryptJson(sample, key());
    expect(() => decryptJson(parts, key())).toThrow();
  });

  it('refuses an encryption key that is not 32 bytes', () => {
    expect(() => encryptJson(sample, randomBytes(16))).toThrow(/32 bytes/);
  });

  describe('readSecretKey', () => {
    it('accepts 32 bytes of base64', () => {
      const raw = key();
      const k = readSecretKey({ VITAL_SECRET_KEY: raw.toString('base64') });
      expect(k?.equals(raw)).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      const raw = key();
      expect(readSecretKey({ VITAL_SECRET_KEY: ` ${raw.toString('base64')}\n` })?.equals(raw)).toBe(true);
    });

    it('rejects empty, missing and wrong-length keys', () => {
      expect(readSecretKey({})).toBeNull();
      expect(readSecretKey({ VITAL_SECRET_KEY: '' })).toBeNull();
      expect(readSecretKey({ VITAL_SECRET_KEY: '   ' })).toBeNull();
      expect(readSecretKey({ VITAL_SECRET_KEY: randomBytes(16).toString('base64') })).toBeNull();
      expect(readSecretKey({ VITAL_SECRET_KEY: randomBytes(33).toString('base64') })).toBeNull();
      expect(readSecretKey({ VITAL_SECRET_KEY: 'not base64 !!!' })).toBeNull();
    });
  });

  it('keyId is the first 8 hex characters of the sha256, and differs per key', () => {
    const a = Buffer.alloc(32, 1);
    const id = keyId(a);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).toBe('72cd6e84');
    expect(keyId(Buffer.alloc(32, 2))).not.toBe(id);
  });
});
