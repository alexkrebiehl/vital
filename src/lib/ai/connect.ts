// ── AI providers and model choices: the route logic (SERVER ONLY) ──
//
// The logic behind /api/ai/providers and /api/ai/assignments. The route files
// only call these, because a Next.js route file may export nothing but its
// handlers.
//
// Every response is `private, no-store`. No body, header or log line holds an
// API key, a prefix of it or the ciphertext: the only trace of a key is its last
// 4 characters (and only for a key of 8 or more). A provider is probed with a
// model-list request before it is stored, and nothing is stored unless the
// server answers and accepts the key.
//
// Everything acts for `currentUserId()` (or `deps.userId`): a provider id that
// belongs to another user is answered exactly like one that does not exist.

import { randomUUID } from 'node:crypto';
import { isLoopbackHost } from '@/lib/analyst/config';
import {
  deleteAssignment,
  deleteProvider,
  getProvider,
  insertProvider,
  isForeignKeyViolation,
  isUniqueViolation,
  listAssignments,
  listProviders,
  putAssignment,
  updateProvider,
} from '@/lib/db/ai-store';
import type { PoolLike } from '@/lib/db/pool';
import { currentUserId } from '@/lib/identity/current-user';
import { readSecretKey } from '@/lib/secrets/crypto';
import { rememberAiKey } from './key-registry';
import { checkKey, listModels, modelListProblem, type ModelListOutcome } from './models';
import { aiClientFor, clearAiSettingsCache } from './settings';
import {
  AI_PROVIDER_KINDS,
  AI_USES,
  parseOptions,
  type AiAssignment,
  type AiOptions,
  type AiProviderKind,
  type AiProviderRecord,
  type AiUse,
} from './types';

export interface AiConnectDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  client?: PoolLike | null;
  userId?: string;
  /** Replaces randomUUID (tests). */
  newId?: () => string;
}

/** What the browser is told about one provider. Never the key. */
export interface AiProviderStatus {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  host: string | null;
  /** The address is on this machine, so a key is optional. */
  loopback: boolean;
  hasKey: boolean;
  keyLast4: string | null;
  /** A key is stored but cannot be read with this server's secret key. */
  needsReentry: boolean;
  usedBy: AiUse[];
  revision: number;
}

export interface AiProvidersBody {
  /** VITAL_SECRET_KEY is present and usable, so a key can be stored. */
  available: boolean;
  /** A database is configured, so anything can be stored. */
  database: boolean;
  providers: AiProviderStatus[];
}

/** What the browser is told about one use's choice. */
export interface AiAssignmentStatus {
  providerId: string;
  model: string;
  options: AiOptions;
  revision: number;
}

export interface AiAssignmentsBody {
  database: boolean;
  assignments: Record<AiUse, AiAssignmentStatus | null>;
}

const NO_STORE = 'private, no-store';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
}

function clientOf(deps: AiConnectDeps): PoolLike | null {
  return aiClientFor({ env: deps.env, aiClient: deps.client });
}

function userOf(deps: AiConnectDeps): string {
  return deps.userId ?? currentUserId();
}

function dropCache(deps: AiConnectDeps): void {
  clearAiSettingsCache({ env: deps.env, aiClient: deps.client, userId: userOf(deps) });
}

/** A key this short would be half-revealed by its last 4 characters. */
function last4(apiKey: string | null): string | null {
  return apiKey && apiKey.length >= 8 ? apiKey.slice(-4) : null;
}

function hostOf(baseUrl: string): { host: string | null; loopback: boolean } {
  try {
    const url = new URL(baseUrl);
    return { host: url.host, loopback: isLoopbackHost(url.hostname) };
  } catch {
    return { host: null, loopback: false };
  }
}

export function toProviderStatus(provider: AiProviderRecord, assignments: AiAssignment[]): AiProviderStatus {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    ...hostOf(provider.baseUrl),
    hasKey: provider.keyState !== 'none',
    keyLast4: last4(provider.apiKey),
    needsReentry: provider.keyState === 'needs_reentry',
    usedBy: AI_USES.filter(use => assignments.some(a => a.use === use && a.providerId === provider.id)),
    revision: provider.revision,
  };
}

const NO_DATABASE = 'A database is required to store AI providers.';
const NO_SECRET_KEY =
  'The server has no usable secret key, so an API key cannot be stored. Run the database setup to create one.';

// ── Providers ───────────────────────────────────────────

async function providersBody(deps: AiConnectDeps): Promise<AiProvidersBody> {
  const env = deps.env ?? process.env;
  const available = readSecretKey(env) !== null;
  const client = clientOf(deps);
  if (!client) return { available, database: false, providers: [] };
  const userId = userOf(deps);
  const [providers, assignments] = await Promise.all([
    listProviders(client, userId, readSecretKey(env)),
    listAssignments(client, userId),
  ]);
  return { available, database: true, providers: providers.map(p => toProviderStatus(p, assignments)) };
}

/** GET /api/ai/providers */
export async function listProviderStatus(deps: AiConnectDeps = {}): Promise<Response> {
  try {
    return json(await providersBody(deps), 200);
  } catch {
    return json({ error: 'The AI providers could not be read.' }, 500);
  }
}

/** The base URL as stored: an http(s) URL, trimmed, trailing slashes dropped. Null when invalid. */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    if (url.search || url.hash) return null;
  } catch {
    return null;
  }
  return trimmed;
}

export const MAX_PROVIDER_NAME = 60;

/** How long a save waits for the provider to answer. */
export const SAVE_PROBE_TIMEOUT_MS = 8000;

interface ProviderInput {
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  /** Blank: keep the stored key on an edit, or store none on a create. */
  apiKey: string;
  /** Remove the stored key (a server on this machine that needs none). */
  removeKey: boolean;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function parseProviderInput(body: Record<string, unknown>): ProviderInput | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Give the provider a name.' };
  if (name.length > MAX_PROVIDER_NAME) return { error: `Keep the name to ${MAX_PROVIDER_NAME} characters or fewer.` };
  const kind = body.kind as AiProviderKind;
  if (!AI_PROVIDER_KINDS.includes(kind)) return { error: 'Choose OpenAI-compatible or Anthropic.' };
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  if (!baseUrl) {
    return { error: 'The address must be an http or https URL, without a user name, password or query.' };
  }
  if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') {
    return { error: 'The API key must be text.' };
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  return { name, kind, baseUrl, apiKey, removeKey: body.removeKey === true };
}

/** The 422 a failed probe answers with. Fixed text: never a header, a body or the key. */
function probeRefusal(outcome: Exclude<ModelListOutcome, { outcome: 'ok' | 'not_listed' }>): Response {
  return json({ error: modelListProblem(outcome), kind: outcome.outcome }, 422);
}

/**
 * Probe a candidate: its model list, then (when a key is given) whether the key
 * is accepted, since a public model list proves nothing about the key. Returns
 * the models (empty when the server has no list) or the refusal.
 */
async function probeCandidate(
  input: { kind: AiProviderKind; baseUrl: string; apiKey: string | null },
  deps: AiConnectDeps
): Promise<{ models: string[]; note: string | null } | Response> {
  const options = { timeoutMs: SAVE_PROBE_TIMEOUT_MS, fetchImpl: deps.fetchImpl };
  const outcome = await listModels(input, options);
  if (outcome.outcome !== 'ok' && outcome.outcome !== 'not_listed') return probeRefusal(outcome);
  if ((await checkKey(input, options)) === 'refused') {
    return json({ error: 'The server refused the API key.', kind: 'unauthorised' }, 422);
  }
  return outcome.outcome === 'ok' ? { models: outcome.models, note: null } : { models: [], note: modelListProblem(outcome) };
}

function preconditions(deps: AiConnectDeps, needsKey: boolean): Response | PoolLike {
  const client = clientOf(deps);
  if (!client) return json({ error: NO_DATABASE }, 503);
  if (needsKey && !readSecretKey(deps.env ?? process.env)) return json({ error: NO_SECRET_KEY }, 503);
  return client;
}

function keyRequired(baseUrl: string, apiKey: string | null): boolean {
  return !apiKey && !hostOf(baseUrl).loopback;
}

const KEY_REQUIRED = 'An API key is required for a server that is not on this machine.';
const NAME_TAKEN = 'You already have a provider with that name.';

/** POST /api/ai/providers { name, kind, baseUrl, apiKey? } */
export async function createProvider(request: Request, deps: AiConnectDeps = {}): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: 'The request body must be JSON.' }, 400);
  const input = parseProviderInput(body);
  if ('error' in input) return json(input, 400);

  const apiKey = input.apiKey || null;
  if (keyRequired(input.baseUrl, apiKey)) return json({ error: KEY_REQUIRED }, 400);
  const ready = preconditions(deps, apiKey !== null);
  if (ready instanceof Response) return ready;
  rememberAiKey(apiKey);

  const probe = await probeCandidate({ kind: input.kind, baseUrl: input.baseUrl, apiKey }, deps);
  if (probe instanceof Response) return probe;

  const id = (deps.newId ?? randomUUID)();
  try {
    await insertProvider(ready, userOf(deps), id, { ...input, apiKey }, readSecretKey(deps.env ?? process.env));
  } catch (error) {
    if (isUniqueViolation(error)) return json({ error: NAME_TAKEN }, 409);
    return json({ error: 'The provider could not be stored.' }, 500);
  }
  dropCache(deps);
  const listing = await providersBody(deps);
  return json({ ...listing, saved: id, models: probe.models, note: probe.note }, 201);
}

/** PUT /api/ai/providers/[id] { name, kind, baseUrl, apiKey?, removeKey? } */
export async function editProvider(id: string, request: Request, deps: AiConnectDeps = {}): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: 'The request body must be JSON.' }, 400);
  const input = parseProviderInput(body);
  if ('error' in input) return json(input, 400);

  const env = deps.env ?? process.env;
  const client = clientOf(deps);
  if (!client) return json({ error: NO_DATABASE }, 503);
  const current = await getProvider(client, userOf(deps), id, readSecretKey(env));
  if (!current) return json({ error: 'That provider does not exist.' }, 404);

  // Blank: keep the stored key. A stored key this server cannot read must be typed again.
  let apiKey: string | null;
  if (input.removeKey) apiKey = null;
  else if (input.apiKey) apiKey = input.apiKey;
  else if (current.keyState === 'needs_reentry') return json({ error: 'Enter the API key again.' }, 400);
  else apiKey = current.apiKey;

  if (keyRequired(input.baseUrl, apiKey)) return json({ error: KEY_REQUIRED }, 400);
  const ready = preconditions(deps, apiKey !== null);
  if (ready instanceof Response) return ready;
  rememberAiKey(apiKey);

  const probe = await probeCandidate({ kind: input.kind, baseUrl: input.baseUrl, apiKey }, deps);
  if (probe instanceof Response) return probe;

  try {
    const found = await updateProvider(ready, userOf(deps), id, { ...input, apiKey }, readSecretKey(env));
    if (!found) return json({ error: 'That provider does not exist.' }, 404);
  } catch (error) {
    if (isUniqueViolation(error)) return json({ error: NAME_TAKEN }, 409);
    return json({ error: 'The provider could not be stored.' }, 500);
  }
  dropCache(deps);
  const listing = await providersBody(deps);
  return json({ ...listing, saved: id, models: probe.models, note: probe.note }, 200);
}

/** DELETE /api/ai/providers/[id] — also clears every use that ran on it. */
export async function removeProvider(id: string, deps: AiConnectDeps = {}): Promise<Response> {
  const client = clientOf(deps);
  if (!client) return json({ error: NO_DATABASE }, 503);
  try {
    const removed = await deleteProvider(client, userOf(deps), id);
    if (!removed) return json({ error: 'That provider does not exist.' }, 404);
  } catch {
    return json({ error: 'The provider could not be removed.' }, 500);
  }
  dropCache(deps);
  return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
}

/** How long the model picker waits for a list. */
export const MODEL_LIST_TIMEOUT_MS = 8000;

/** GET /api/ai/providers/[id]/models — `{ models, note }`; a server without a list is not an error. */
export async function providerModels(id: string, deps: AiConnectDeps = {}): Promise<Response> {
  const client = clientOf(deps);
  if (!client) return json({ error: NO_DATABASE }, 503);
  const provider = await getProvider(client, userOf(deps), id, readSecretKey(deps.env ?? process.env));
  if (!provider) return json({ error: 'That provider does not exist.' }, 404);
  if (provider.keyState === 'needs_reentry') {
    return json({ models: [], note: 'The stored API key must be entered again before the models can be listed.' }, 200);
  }
  const outcome = await listModels(
    { kind: provider.kind, baseUrl: provider.baseUrl, apiKey: provider.apiKey },
    { timeoutMs: MODEL_LIST_TIMEOUT_MS, fetchImpl: deps.fetchImpl }
  );
  if (outcome.outcome === 'ok') return json({ models: outcome.models, note: null }, 200);
  return json({ models: [], note: modelListProblem(outcome) }, 200);
}

// ── Assignments ─────────────────────────────────────────

function assignmentsRecord(assignments: AiAssignment[]): Record<AiUse, AiAssignmentStatus | null> {
  const out = {} as Record<AiUse, AiAssignmentStatus | null>;
  for (const use of AI_USES) {
    const a = assignments.find(x => x.use === use);
    out[use] = a ? { providerId: a.providerId, model: a.model, options: a.options, revision: a.revision } : null;
  }
  return out;
}

async function assignmentsBody(deps: AiConnectDeps): Promise<AiAssignmentsBody> {
  const client = clientOf(deps);
  if (!client) return { database: false, assignments: assignmentsRecord([]) };
  return { database: true, assignments: assignmentsRecord(await listAssignments(client, userOf(deps))) };
}

/** GET /api/ai/assignments */
export async function listAssignmentStatus(deps: AiConnectDeps = {}): Promise<Response> {
  try {
    return json(await assignmentsBody(deps), 200);
  } catch {
    return json({ error: 'The AI model choices could not be read.' }, 500);
  }
}

export const MAX_MODEL_ID = 200;

/**
 * PUT /api/ai/assignments { use, providerId | null, model, options, revision }
 *
 * `revision` is the revision the page last read (0 when the use had no choice);
 * a stale one is refused with 409 and the current choice, as /api/preferences
 * does. `providerId: null` clears the use.
 */
export async function saveAssignment(request: Request, deps: AiConnectDeps = {}): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: 'The request body must be JSON.' }, 400);
  const use = body.use as AiUse;
  if (!AI_USES.includes(use)) return json({ error: 'Unknown use.' }, 400);
  const revision = typeof body.revision === 'number' && Number.isInteger(body.revision) ? body.revision : null;
  if (revision === null || revision < 0) return json({ error: 'The revision must be a whole number.' }, 400);

  const client = clientOf(deps);
  if (!client) return json({ error: NO_DATABASE }, 503);
  const userId = userOf(deps);

  const current = (await listAssignments(client, userId)).find(a => a.use === use) ?? null;
  if ((current?.revision ?? 0) !== revision) {
    return json({ error: 'This choice was changed elsewhere. The current one is shown.', current: assignmentsRecord(current ? [current] : [])[use] }, 409);
  }

  if (body.providerId === null) {
    await deleteAssignment(client, userId, use);
  } else {
    if (typeof body.providerId !== 'string' || !body.providerId) return json({ error: 'Choose a provider.' }, 400);
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return json({ error: 'Choose a model.' }, 400);
    if (model.length > MAX_MODEL_ID) return json({ error: 'That model id is too long.' }, 400);
    const provider = await getProvider(client, userId, body.providerId, null);
    if (!provider) return json({ error: 'That provider does not exist.' }, 404);
    try {
      await putAssignment(client, userId, use, { providerId: provider.id, model, options: parseOptions(use, body.options) });
    } catch (error) {
      if (isForeignKeyViolation(error)) return json({ error: 'That provider does not exist.' }, 404);
      return json({ error: 'The choice could not be stored.' }, 500);
    }
  }
  dropCache(deps);
  return json(await assignmentsBody(deps), 200);
}
