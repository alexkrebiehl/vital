// ── Oura access tokens with rotation-safe refresh (SERVER ONLY) ──────────────
//
// Oura's refresh token is single-use: every refresh returns a new one and kills
// the old. Spending the old one twice (two requests refreshing at once, or two
// server bundles) would disconnect the user. Two guards:
//
//   1. an in-process single-flight on `globalThis` (the same pattern as
//      workout-sources/store.ts, because Next builds several server bundles),
//   2. a Postgres row lock: `SELECT … FOR UPDATE`, re-check expiry inside the
//      lock, refresh, store the NEW tokens, COMMIT, and only then return.
//
// If Oura rejects the refresh (400/401) the row is deleted and the caller is
// told the source needs reconnecting. A transient failure (network, 5xx) keeps
// the row and is rethrown unchanged. A row written under another key is reported
// as "needs reconnect" and left alone: restoring the key makes it usable again.
//
// No token appears in any error raised here.

import {
  getCredential,
  withLockedCredential,
  type CredentialRead,
  type StoredCredential,
} from '@/lib/db/credentials-store';
import type { PoolLike } from '@/lib/db/pool';
import type { OuraConfig } from './config';
import type { OuraHttpDeps } from './http';
import { OuraAuthError, refreshTokens, type OuraTokenSet } from './oauth';

export const OURA_SOURCE_ID = 'oura';

export type NotConnectedReason = 'not_connected' | 'needs_reconnect';

export class OuraNotConnectedError extends Error {
  constructor(readonly reason: NotConnectedReason = 'not_connected') {
    super(
      reason === 'needs_reconnect'
        ? 'Oura needs to be reconnected in Settings.'
        : 'Oura is not connected. Connect it in Settings.'
    );
    this.name = 'OuraNotConnectedError';
  }
}

export interface TokenDeps {
  config: OuraConfig;
  client: PoolLike;
  /** The decoded VITAL_SECRET_KEY, or null when none is valid. */
  key: Buffer | null;
  http?: OuraHttpDeps;
  now?: () => number;
  /** Replaceable in tests. Defaults to the real refresh call. */
  refresh?: (cfg: OuraConfig, refreshToken: string, http: OuraHttpDeps) => Promise<OuraTokenSet>;
}

export interface TokenRequest {
  /**
   * An access token the API just refused (a 401). If the stored one is already
   * different, someone else refreshed: return it. If it is the same, refresh now
   * even though it has not expired by the clock.
   */
  rejectedToken?: string;
}

type Flights = Map<string, Promise<string>>;
const FLIGHTS_KEY = Symbol.for('vital.oura.token-flights');

function flights(): Flights {
  const g = globalThis as unknown as Record<symbol, Flights | undefined>;
  if (!g[FLIGHTS_KEY]) g[FLIGHTS_KEY] = new Map();
  return g[FLIGHTS_KEY]!;
}

/** Forget in-flight refreshes. Tests only. */
export function resetTokenFlightsForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[FLIGHTS_KEY];
}

function usable(cred: StoredCredential, nowMs: number, req: TokenRequest): boolean {
  if (req.rejectedToken !== undefined && cred.tokens.accessToken === req.rejectedToken) return false;
  return cred.accessExpiresAt.getTime() > nowMs;
}

function requireUsable(read: CredentialRead | null): StoredCredential {
  if (!read) throw new OuraNotConnectedError('not_connected');
  if (read.needsReconnect) throw new OuraNotConnectedError('needs_reconnect');
  return read;
}

async function resolveToken(deps: TokenDeps, req: TokenRequest): Promise<string> {
  const now = deps.now ?? Date.now;

  // Cheap path, no lock: most calls find a valid token.
  const first = requireUsable(await getCredential(deps.client, OURA_SOURCE_ID, deps.key));
  if (usable(first, now(), req)) return first.tokens.accessToken;

  const refresh = deps.refresh ?? ((cfg, rt, http) => refreshTokens(cfg, rt, http));
  type Outcome = { token: string } | { rejected: true };

  const outcome = await withLockedCredential<Outcome>(deps.client, OURA_SOURCE_ID, deps.key, async locked => {
    // Another caller (or bundle) may have refreshed while this one waited.
    const cred = requireUsable(locked.current);
    if (usable(cred, now(), req)) return { token: cred.tokens.accessToken };
    try {
      const fresh = await refresh(deps.config, cred.tokens.refreshToken, { ...deps.http, now });
      // Stored inside the transaction, committed before this function returns.
      await locked.put(
        { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken },
        fresh.scopes ?? cred.scopes,
        fresh.expiresAt
      );
      return { token: fresh.accessToken };
    } catch (error) {
      if (error instanceof OuraAuthError && error.kind === 'rejected') {
        await locked.delete();
        return { rejected: true };
      }
      throw error;
    }
  });

  if ('rejected' in outcome) throw new OuraNotConnectedError('needs_reconnect');
  return outcome.token;
}

/**
 * A valid access token, refreshing under a lock when the stored one has expired.
 * Throws `OuraNotConnectedError` when there is no usable credential.
 */
export function getAccessToken(deps: TokenDeps, req: TokenRequest = {}): Promise<string> {
  const map = flights();
  const id = `${OURA_SOURCE_ID}|${req.rejectedToken ?? ''}`;
  const running = map.get(id);
  if (running) return running;
  const flight = resolveToken(deps, req).finally(() => {
    if (map.get(id) === flight) map.delete(id);
  });
  map.set(id, flight);
  return flight;
}
