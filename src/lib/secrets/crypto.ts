// ── Secret-key crypto (SERVER ONLY) ──────────────────────
//
// AES-256-GCM for the OAuth tokens kept in `source_credentials`. The key comes
// from VITAL_SECRET_KEY (32 random bytes, base64). Nothing here logs, and no
// error message contains the key or the plaintext.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedParts {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** The key from `VITAL_SECRET_KEY`, or null when it is absent or not exactly 32 bytes of base64. */
export function readSecretKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = (env.VITAL_SECRET_KEY ?? '').trim();
  if (!raw || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** First 8 hex characters of sha256(key): tells a rotated key from the current one. */
export function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error('The secret key must be 32 bytes.');
}

export function encryptJson(value: unknown, key: Buffer): EncryptedParts {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/** Throws when the key is wrong or the ciphertext or tag was altered. */
export function decryptJson<T = unknown>(parts: EncryptedParts, key: Buffer): T {
  assertKey(key);
  if (parts.iv.length !== IV_BYTES || parts.authTag.length !== TAG_BYTES) {
    throw new Error('The stored secret is malformed.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, parts.iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(parts.authTag);
  const plain = Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
