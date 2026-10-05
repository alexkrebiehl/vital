// ── The OAuth sign-in cookie (SERVER ONLY) ───────────────
//
// The `state` and the PKCE verifier travel between the authorize and callback
// requests in one cookie, encrypted with the same AES-256-GCM helper that
// protects the stored tokens: the browser holds it but cannot read or forge it.
// The cookie is httpOnly, SameSite=Lax, scoped to the Oura routes and lives ten
// minutes. It carries no token: those arrive only after the callback.

import { createHash, timingSafeEqual } from 'node:crypto';
import { decryptJson, encryptJson } from '@/lib/secrets/crypto';

export const OAUTH_COOKIE = 'vital_oura_oauth';
export const OAUTH_COOKIE_PATH = '/api/sources/oura';
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

export interface OAuthSession {
  state: string;
  verifier: string;
  /** Milliseconds since the epoch when the sign-in began. */
  ts: number;
}

/** `iv.tag.ciphertext`, each base64url. */
export function sealSession(session: OAuthSession, key: Buffer): string {
  const parts = encryptJson(session, key);
  return [parts.iv, parts.authTag, parts.ciphertext].map(b => b.toString('base64url')).join('.');
}

/** The session, or null when the value is absent, altered or sealed under another key. */
export function openSession(value: string | null | undefined, key: Buffer): OAuthSession | null {
  if (!value) return null;
  const pieces = value.split('.');
  if (pieces.length !== 3) return null;
  try {
    const [iv, authTag, ciphertext] = pieces.map(p => Buffer.from(p, 'base64url'));
    const plain = decryptJson<Partial<OAuthSession>>({ iv, authTag, ciphertext }, key);
    if (typeof plain.state !== 'string' || typeof plain.verifier !== 'string' || typeof plain.ts !== 'number') return null;
    return { state: plain.state, verifier: plain.verifier, ts: plain.ts };
  } catch {
    return null;
  }
}

/** Constant-time comparison of two strings of any length (both are hashed first). */
export function sameState(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function secureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}

export function setSessionCookie(request: Request, value: string): string {
  return (
    `${OAUTH_COOKIE}=${value}; Path=${OAUTH_COOKIE_PATH}; Max-Age=${OAUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax` +
    (secureRequest(request) ? '; Secure' : '')
  );
}

export function clearSessionCookie(request: Request): string {
  return (
    `${OAUTH_COOKIE}=; Path=${OAUTH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax` +
    (secureRequest(request) ? '; Secure' : '')
  );
}
