// ── Health Auto Export connection: status, save, remove (SERVER ONLY) ────────
//
// The logic behind /api/sources/hae. The route file only calls these, because a
// Next.js route file may export nothing but its handlers.
//
// Every response is `private, no-store`. No body, header or log line holds the
// API key, a prefix of it or the ciphertext: the only trace of it is its last 4
// characters, in the status. A save is probed first with the same read-only
// request the pipeline makes, and nothing is stored unless it succeeds.

import type { PoolLike } from '@/lib/db/pool';
import { reconcileQuietly } from '@/lib/sources/purge';
import { defaultContext } from '@/lib/sources/registry';
import { clearRouteStore } from '@/lib/activity-maps/routes';
import { liveCache } from './cache';
import { clearLiveCaches } from './live';
import { buildHaeConfig, probeHae, type HaeProbeResult } from './hae';
import {
  haeClientFor,
  haeKeyUsable,
  lastHaeError,
  readStoredHae,
  removeStoredHae,
  saveStoredHae,
  type StoredHae,
} from './hae-store';

export interface HaeConnectDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  client?: PoolLike | null;
  now?: () => number;
}

export interface HaeStatus {
  /** VITAL_SECRET_KEY is present and usable, so a connection can be stored. */
  available: boolean;
  configured: boolean;
  endpoint: string | null;
  keyLast4: string | null;
  needsReentry: boolean;
  lastError: { kind: string; message: string } | null;
}

const NO_STORE = 'private, no-store';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
}

function storeDeps(deps: HaeConnectDeps) {
  return { env: deps.env ?? process.env, haeClient: deps.client };
}

/** A key this short would be half-revealed by its last 4 characters. */
function last4(apiKey: string): string | null {
  return apiKey.length >= 8 ? apiKey.slice(-4) : null;
}

function toStatus(stored: StoredHae, available: boolean): HaeStatus {
  if (stored.state === 'none') {
    return { available, configured: false, endpoint: null, keyLast4: null, needsReentry: false, lastError: null };
  }
  if (stored.state === 'needs_reentry') {
    return { available, configured: true, endpoint: null, keyLast4: null, needsReentry: true, lastError: null };
  }
  return {
    available,
    configured: true,
    endpoint: stored.endpoint,
    keyLast4: last4(stored.apiKey),
    needsReentry: false,
    lastError: lastHaeError(),
  };
}

async function statusBody(deps: HaeConnectDeps): Promise<HaeStatus> {
  const env = deps.env ?? process.env;
  return toStatus(await readStoredHae(storeDeps(deps)), haeKeyUsable(env));
}

/**
 * What was read through the old connection must not outlive it: the datasets,
 * the medications window and the held workout routes all came from that server.
 */
function clearHaeCaches(): void {
  clearLiveCaches();
  for (const key of liveCache.stats().keys) if (key.startsWith('medications:')) liveCache.clear(key);
  clearRouteStore();
}

/** Saving or removing changes the active set: purge what the old set left in memory now. */
async function reconcileAfterChange(deps: HaeConnectDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const client = haeClientFor(storeDeps(deps));
  await reconcileQuietly(defaultContext(env, () => client));
}

/** GET /api/sources/hae */
export async function status(deps: HaeConnectDeps = {}): Promise<Response> {
  return json(await statusBody(deps), 200);
}

/** The endpoint as stored: an http(s) URL, trimmed, trailing slashes dropped. Null when invalid. */
export function normalizeEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
  } catch {
    return null;
  }
  return trimmed;
}

/** A plain refusal for a failed probe. Fixed text: it never echoes a header, a body or the key. */
function probeFailure(probe: HaeProbeResult): { kind: string; message: string } {
  if (probe.outcome === 'timeout') {
    return { kind: 'timeout', message: 'The server did not answer in time. Check the address and that it is running.' };
  }
  if (probe.outcome === 'http_error' && (probe.httpStatus === 401 || probe.httpStatus === 403)) {
    return { kind: 'unauthorised', message: 'The server refused the API key.' };
  }
  if (probe.outcome === 'http_error') {
    return { kind: 'http_error', message: `The server answered HTTP ${probe.httpStatus ?? 'error'}. Check the address.` };
  }
  if (probe.outcome === 'invalid_payload') {
    return { kind: 'invalid_payload', message: 'The server answered, but not with the data that was expected. Check the address.' };
  }
  return { kind: 'unreachable', message: 'The server could not be reached. Check the address and that it is running.' };
}

/** PUT /api/sources/hae { endpoint, apiKey? } */
export async function save(request: Request, deps: HaeConnectDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body must be JSON.' }, 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as { endpoint?: unknown; apiKey?: unknown };
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) {
    return json({ error: 'The endpoint must be an http or https address, without a user name or password.' }, 400);
  }
  if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== 'string') {
    return json({ error: 'The API key must be text.' }, 400);
  }
  const submitted = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';

  if (!haeKeyUsable(env)) {
    return json({ error: 'The server has no usable secret key, so the connection cannot be stored. Run the database setup to create one.' }, 503);
  }
  if (!haeClientFor(storeDeps(deps))) {
    return json({ error: 'A database is required to store the connection.' }, 503);
  }

  // Omitted or blank: keep the stored key, if there is one.
  let apiKey = submitted;
  if (!apiKey) {
    const stored = await readStoredHae(storeDeps(deps));
    if (stored.state !== 'ok') return json({ error: 'An API key is required.' }, 400);
    apiKey = stored.apiKey;
  }

  const candidate = buildHaeConfig(endpoint, apiKey, env);
  if (!candidate) return json({ error: 'An API key is required.' }, 400);
  const probe = await probeHae({ env, fetchImpl: deps.fetchImpl, haeConfig: candidate }, deps.now);
  if (probe.outcome !== 'ok') {
    const failure = probeFailure(probe);
    return json({ error: failure.message, kind: failure.kind }, 422);
  }

  try {
    await saveStoredHae(storeDeps(deps), { endpoint, apiKey });
  } catch {
    return json({ error: 'The connection could not be stored.' }, 500);
  }
  clearHaeCaches();
  await reconcileAfterChange(deps);
  return json(await statusBody(deps), 200);
}

/** DELETE /api/sources/hae */
export async function remove(deps: HaeConnectDeps = {}): Promise<Response> {
  if (!haeClientFor(storeDeps(deps))) {
    return json({ error: 'A database is required to manage the connection.' }, 503);
  }
  try {
    await removeStoredHae(storeDeps(deps));
  } catch {
    return json({ error: 'The connection could not be removed.' }, 500);
  }
  clearHaeCaches();
  await reconcileAfterChange(deps);
  return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
}
