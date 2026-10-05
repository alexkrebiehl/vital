// ── Oura OAuth2 + PKCE helpers (SERVER ONLY) ─────────────
//
// Pure URL/PKCE construction plus three fetch-injected calls: exchange a code,
// refresh, revoke. Client id and secret travel as HTTP Basic; the body is
// form-encoded. The refresh token is single-use, so every refresh returns a new
// one that the caller must persist before using the access token.
//
// No error raised here contains a token, a code, a verifier or the secret.

import { bareScope } from '@/lib/db/credentials-store';
import { createHash, randomInt } from 'node:crypto';
import { OURA_AUTHORIZE_URL, type OuraConfig } from './config';
import { timedFetch, TimedFetchError, type OuraHttpDeps } from './http';

/**
 * Granted scopes from a token reply. Oura's reply may name them space- or
 * comma-separated, or as a list, and may leave them empty; an empty or missing
 * answer means "not stated" (null), never "nothing was granted" — a grant of
 * nothing could not have produced a token.
 */
export function parseGrantedScopes(raw: unknown): string[] | null {
  const parts = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];
  const scopes = parts.flatMap(p => p.split(/[\s,]+/)).filter(Boolean).map(bareScope);
  return scopes.length ? scopes : null;
}

/** Expiry is taken this much earlier than Oura states, so a token is never used at its edge. */
export const ACCESS_EXPIRY_MARGIN_MS = 60_000;

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const VERIFIER_LENGTH = 64;

export type OuraAuthFailureKind = 'rejected' | 'http_error' | 'network_error' | 'timeout' | 'invalid_payload';

export class OuraAuthError extends Error {
  constructor(
    message: string,
    readonly kind: OuraAuthFailureKind,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'OuraAuthError';
  }
}

export interface OuraTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  /** Granted scopes from the reply; null when the reply did not say. */
  scopes: string[] | null;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** A 64-character verifier from the unreserved charset, and its S256 challenge (no padding). */
export function pkcePair(): { verifier: string; challenge: string } {
  let verifier = '';
  for (let i = 0; i < VERIFIER_LENGTH; i += 1) verifier += UNRESERVED[randomInt(UNRESERVED.length)];
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function buildAuthorizeUrl(cfg: OuraConfig, state: string, challenge: string): string {
  const url = new URL(OURA_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function basicAuth(cfg: OuraConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64')}`;
}

/** An OAuth error code such as `invalid_grant`, only when it is plainly one. */
function oauthCode(body: unknown): string | null {
  const code = (body as { error?: unknown } | null)?.error;
  return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : null;
}

async function postToken(cfg: OuraConfig, form: URLSearchParams, what: string, deps: OuraHttpDeps): Promise<OuraTokenSet> {
  let res: Response;
  try {
    res = await timedFetch(
      `${cfg.apiUrl}/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: basicAuth(cfg),
        },
        body: form.toString(),
      },
      deps
    );
  } catch (error) {
    const kind = error instanceof TimedFetchError ? error.kind : 'network_error';
    throw new OuraAuthError(`Oura ${what} failed: ${kind === 'timeout' ? 'the request timed out' : 'network error'}.`, kind);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const rejected = res.status === 400 || res.status === 401;
    const code = oauthCode(body);
    throw new OuraAuthError(
      `Oura ${what} was ${rejected ? 'rejected' : 'refused'} (HTTP ${res.status}${code ? `, ${code}` : ''}).`,
      rejected ? 'rejected' : 'http_error',
      res.status
    );
  }

  const t = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown } | null;
  const expiresIn = Number(t?.expires_in);
  if (
    !t ||
    typeof t.access_token !== 'string' || !t.access_token ||
    typeof t.refresh_token !== 'string' || !t.refresh_token ||
    !Number.isFinite(expiresIn) || expiresIn <= 0
  ) {
    throw new OuraAuthError(`Oura ${what} returned a reply without the expected fields.`, 'invalid_payload', res.status);
  }
  const now = (deps.now ?? Date.now)();
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(now + expiresIn * 1000 - ACCESS_EXPIRY_MARGIN_MS),
    scopes: parseGrantedScopes(t.scope),
  };
}

export function exchangeCode(cfg: OuraConfig, code: string, verifier: string, deps: OuraHttpDeps = {}): Promise<OuraTokenSet> {
  return postToken(
    cfg,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    }),
    'token exchange',
    deps
  );
}

export function refreshTokens(cfg: OuraConfig, refreshToken: string, deps: OuraHttpDeps = {}): Promise<OuraTokenSet> {
  return postToken(
    cfg,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    'token refresh',
    deps
  );
}

/** Revoke an access token. Resolves on any 2xx; throws `OuraAuthError` otherwise. */
export async function revoke(cfg: OuraConfig, accessToken: string, deps: OuraHttpDeps = {}): Promise<void> {
  let res: Response;
  try {
    res = await timedFetch(
      `${cfg.apiUrl}/oauth/revoke?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      deps
    );
  } catch (error) {
    const kind = error instanceof TimedFetchError ? error.kind : 'network_error';
    throw new OuraAuthError(`Oura token revoke failed: ${kind === 'timeout' ? 'the request timed out' : 'network error'}.`, kind);
  }
  if (!res.ok) throw new OuraAuthError(`Oura token revoke was refused (HTTP ${res.status}).`, 'http_error', res.status);
}
