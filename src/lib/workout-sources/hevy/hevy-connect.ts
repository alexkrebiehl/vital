// ── Hevy connection: status, save, remove (SERVER ONLY) ──────────────────────
//
// The logic behind /api/sources/hevy. The route file only calls these, because a
// Next.js route file may export nothing but its handlers.
//
// Every response is `private, no-store`. No body, header or log line holds the
// API key, a prefix of it or the ciphertext: the only trace of it is its last 4
// characters, in the status. A save is probed first with a read-only request
// (page 1 of workouts, one per page), and nothing is stored unless it succeeds.

import { normalizeEndpoint } from '@/lib/adapters/hae-connect';
import { clearLiveCaches } from '@/lib/adapters/live';
import type { PoolLike } from '@/lib/db/pool';
import { reconcileQuietly } from '@/lib/sources/purge';
import { defaultContext } from '@/lib/sources/registry';
import { lastTrainingSourceError, purgeTrainingSources } from '../store';
import type { SourceRequestDeps } from '../types';
import { buildHevyConfig, hevyGet, HevyError } from './client';
import {
  hevyClientFor,
  hevyKeyUsable,
  readStoredHevy,
  removeStoredHevy,
  saveStoredHevy,
  HEVY_STORE_SOURCE_ID,
  type StoredHevy,
} from './hevy-store';

export interface HevyConnectDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  client?: PoolLike | null;
  now?: () => number;
}

export interface HevyStatus {
  /** VITAL_SECRET_KEY is present and usable, so a connection can be stored. */
  available: boolean;
  configured: boolean;
  /** The stored API URL; null when blank (the default API) or nothing is stored. */
  url: string | null;
  keyLast4: string | null;
  needsReentry: boolean;
  lastError: { kind: string; message: string } | null;
}

/** How long a save waits for the server to answer. */
export const HEVY_SAVE_PROBE_TIMEOUT_MS = 8000;

const NO_STORE = 'private, no-store';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
}

function storeDeps(deps: HevyConnectDeps) {
  return { env: deps.env ?? process.env, hevyClient: deps.client, now: deps.now };
}

/** A key this short would be half-revealed by its last 4 characters. */
function last4(apiKey: string): string | null {
  return apiKey.length >= 8 ? apiKey.slice(-4) : null;
}

/** The last sync failure, as the training store holds it. A stored key never appears in it. */
function syncError(apiKey: string): { kind: string; message: string } | null {
  const message = lastTrainingSourceError(HEVY_STORE_SOURCE_ID);
  if (!message) return null;
  return { kind: 'sync_failed', message: apiKey ? message.split(apiKey).join('…') : message };
}

function toStatus(stored: StoredHevy, available: boolean): HevyStatus {
  if (stored.state === 'none') {
    return { available, configured: false, url: null, keyLast4: null, needsReentry: false, lastError: null };
  }
  if (stored.state === 'needs_reentry') {
    return { available, configured: true, url: null, keyLast4: null, needsReentry: true, lastError: null };
  }
  return {
    available,
    configured: true,
    url: stored.url || null,
    keyLast4: last4(stored.apiKey),
    needsReentry: false,
    lastError: syncError(stored.apiKey),
  };
}

async function statusBody(deps: HevyConnectDeps): Promise<HevyStatus> {
  const env = deps.env ?? process.env;
  return toStatus(await readStoredHevy(storeDeps(deps)), hevyKeyUsable(env));
}

/** Saving or removing changes what is read, and from where: drop what the old connection left in memory. */
async function clearAfterChange(deps: HevyConnectDeps): Promise<void> {
  clearLiveCaches();
  purgeTrainingSources([HEVY_STORE_SOURCE_ID]);
  const env = deps.env ?? process.env;
  const client = hevyClientFor(storeDeps(deps));
  await reconcileQuietly(defaultContext(env, () => client));
}

/** A plain refusal for a failed probe. Fixed text: it never echoes a header, a body or the key. */
function probeFailure(error: HevyError): { kind: string; message: string } {
  if (error.kind === 'timeout') {
    return { kind: 'timeout', message: 'The server did not answer in time. Check the address and your connection.' };
  }
  if (error.kind === 'unauthorized') return { kind: 'unauthorised', message: 'The server refused the API key.' };
  if (error.kind === 'rate_limited') {
    return { kind: 'rate_limited', message: 'The server is limiting requests right now. Try again in a minute.' };
  }
  if (error.kind === 'http_error') {
    return { kind: 'http_error', message: `The server answered HTTP ${error.httpStatus ?? 'error'}. Check the address.` };
  }
  if (error.kind === 'invalid_payload') {
    return { kind: 'invalid_payload', message: 'The server answered, but not with the data that was expected. Check the address.' };
  }
  return { kind: 'unreachable', message: 'The server could not be reached. Check the address and your connection.' };
}

/** One read-only request with the candidate values. Resolves to null on success. */
async function probeCandidate(
  apiKey: string,
  url: string,
  deps: HevyConnectDeps
): Promise<{ kind: string; message: string } | null> {
  const env = deps.env ?? process.env;
  const config = buildHevyConfig(apiKey, url, env);
  if (!config) return { kind: 'missing_key', message: 'An API key is required.' };
  const requestDeps: SourceRequestDeps = { env, fetchImpl: deps.fetchImpl, now: deps.now };
  try {
    const body = await hevyGet<{ workouts?: unknown }>(
      { ...config, timeoutMs: HEVY_SAVE_PROBE_TIMEOUT_MS, rateLimitRetries: 0 },
      '/v1/workouts?page=1&pageSize=1',
      requestDeps
    );
    if (!Array.isArray(body.workouts)) {
      return probeFailure(new HevyError('not a workouts page', 'invalid_payload'));
    }
    return null;
  } catch (error) {
    return probeFailure(error instanceof HevyError ? error : new HevyError('failed', 'network_error'));
  }
}

/** GET /api/sources/hevy */
export async function status(deps: HevyConnectDeps = {}): Promise<Response> {
  return json(await statusBody(deps), 200);
}

/** PUT /api/sources/hevy { apiKey?, url? } */
export async function save(request: Request, deps: HevyConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body must be JSON.' }, 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as { apiKey?: unknown; url?: unknown };
  if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== 'string') {
    return json({ error: 'The API key must be text.' }, 400);
  }
  if (input.url !== undefined && input.url !== null && typeof input.url !== 'string') {
    return json({ error: 'The API URL must be text.' }, 400);
  }
  const submitted = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';

  // Blank means Hevy's own API. Omitted keeps the stored URL.
  let url: string | null = null;
  if (typeof input.url === 'string') {
    if (input.url.trim() === '') url = '';
    else {
      url = normalizeEndpoint(input.url);
      if (!url) {
        return json({ error: 'The API URL must be an http or https address, without a user name or password.' }, 400);
      }
    }
  }

  if (!hevyKeyUsable(env)) {
    return json({ error: 'The server has no usable secret key, so the connection cannot be stored. Run the database setup to create one.' }, 503);
  }
  if (!hevyClientFor(storeDeps(deps))) {
    return json({ error: 'A database is required to store the connection.' }, 503);
  }

  // Omitted or blank: keep what is stored.
  const stored = await readStoredHevy(storeDeps(deps));
  const apiKey = submitted || (stored.state === 'ok' ? stored.apiKey : '');
  if (!apiKey) return json({ error: 'An API key is required.' }, 400);
  if (url === null) url = stored.state === 'ok' ? stored.url : '';

  const failure = await probeCandidate(apiKey, url, deps);
  if (failure) return json({ error: failure.message, kind: failure.kind }, 422);

  try {
    await saveStoredHevy(storeDeps(deps), { apiKey, url });
  } catch {
    return json({ error: 'The connection could not be stored.' }, 500);
  }
  await clearAfterChange(deps);
  return json(await statusBody(deps), 200);
}

/** DELETE /api/sources/hevy */
export async function remove(deps: HevyConnectDeps = {}): Promise<Response> {
  if (!hevyClientFor(storeDeps(deps))) {
    return json({ error: 'A database is required to manage the connection.' }, 503);
  }
  try {
    await removeStoredHevy(storeDeps(deps));
  } catch {
    return json({ error: 'The connection could not be removed.' }, 500);
  }
  await clearAfterChange(deps);
  return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
}
