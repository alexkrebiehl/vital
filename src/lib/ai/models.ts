// ── A provider's model list (SERVER ONLY) ────────────────
//
// One bounded GET of the provider's model list. It serves three callers:
//   * saving a provider in Settings probes it first (is the address right, is
//     the key accepted?), and nothing is stored unless it answers;
//   * the model picker in Preferences lists what the server offers;
//   * the briefing checks that a model server on this machine is running
//     before it asks it to write (briefing/engine.ts).
//
//   openai     GET {base}/models                with Authorization: Bearer <key>
//   anthropic  GET {base}/v1/models?limit=1000  with x-api-key and anthropic-version
//
// A server that answers 404 has no model list (some OpenAI-compatible gateways
// do not implement one): that is `not_listed`, not a failure, and the model id is
// typed instead. Nothing here logs, and no outcome carries the key or a body.
//
// A model list does not always prove the key: OpenRouter's is public. So a save
// that carries a key also runs `checkKey`, which POSTs an EMPTY body to the
// request endpoint. A server refuses a bad key (401/403) before it reads the
// body, and answers an accepted key with a 400 for the empty request, so no
// model runs and nothing is spent.

import { normalizeEndpoint } from '@/lib/analyst/config';
import type { AiProviderKind } from './types';

export const ANTHROPIC_VERSION = '2023-06-01';

export interface ModelListTarget {
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string | null;
}

export type ModelListOutcome =
  | { outcome: 'ok'; models: string[]; host: string }
  | { outcome: 'not_listed'; host: string }
  | { outcome: 'unauthorised'; httpStatus: number; host: string }
  | { outcome: 'http_error'; httpStatus: number; host: string }
  | { outcome: 'invalid_payload'; host: string }
  | { outcome: 'timeout'; host: string | null }
  | { outcome: 'unreachable'; host: string | null }
  | { outcome: 'invalid_url'; reason: string };

export interface ModelListOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** The model-list URL next to the provider's request endpoint, or a reason it has none. */
export function modelListUrl(kind: AiProviderKind, baseUrl: string): { url: string; host: string } | { reason: string } {
  const endpoint = normalizeEndpoint(baseUrl, kind);
  if (!endpoint.url || !endpoint.host) return { reason: endpoint.reason ?? 'The address is not a usable URL.' };
  const url = new URL(endpoint.url);
  if (kind === 'openai') {
    url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
  } else {
    url.pathname = url.pathname.replace(/\/messages$/, '/models');
    url.searchParams.set('limit', '1000');
  }
  return { url: url.toString(), host: endpoint.host };
}

function idsOf(payload: unknown): string[] | null {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return null;
  const ids = data
    .map(entry => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim());
  return [...new Set(ids)];
}

/** Ask the provider for its models. Never throws. */
export async function listModels(target: ModelListTarget, options: ModelListOptions): Promise<ModelListOutcome> {
  const where = modelListUrl(target.kind, target.baseUrl);
  if ('reason' in where) return { outcome: 'invalid_url', reason: where.reason };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { outcome: 'unreachable', host: where.host };

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (target.kind === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    if (target.apiKey) headers['x-api-key'] = target.apiKey;
  } else if (target.apiKey) {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(where.url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      return { outcome: 'unauthorised', httpStatus: response.status, host: where.host };
    }
    if (response.status === 404) return { outcome: 'not_listed', host: where.host };
    if (!response.ok) return { outcome: 'http_error', httpStatus: response.status, host: where.host };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { outcome: 'invalid_payload', host: where.host };
    }
    const models = idsOf(payload);
    if (!models) return { outcome: 'invalid_payload', host: where.host };
    return { outcome: 'ok', models: models.sort((a, b) => a.localeCompare(b)), host: where.host };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return aborted ? { outcome: 'timeout', host: where.host } : { outcome: 'unreachable', host: where.host };
  } finally {
    clearTimeout(timer);
  }
}

export type KeyCheck = 'accepted' | 'refused' | 'unknown';

/**
 * Whether the server accepts the key, from one request with an empty body. 401
 * or 403 is a refusal; any other answer means the key got past authentication.
 * A transport failure is `unknown` (the model list already showed the server
 * answers). Never throws, and the reply body is never read.
 */
export async function checkKey(target: ModelListTarget, options: ModelListOptions): Promise<KeyCheck> {
  if (!target.apiKey) return 'unknown';
  const endpoint = normalizeEndpoint(target.baseUrl, target.kind);
  if (!endpoint.url) return 'unknown';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return 'unknown';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (target.kind === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    headers['x-api-key'] = target.apiKey;
  } else {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, { method: 'POST', headers, body: '{}', cache: 'no-store', signal: controller.signal });
    void response.body?.cancel().catch(() => {});
    return response.status === 401 || response.status === 403 ? 'refused' : 'accepted';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** A plain sentence for an outcome that is not a list. Fixed text: never a header, a body or the key. */
export function modelListProblem(outcome: Exclude<ModelListOutcome, { outcome: 'ok' }>): string {
  switch (outcome.outcome) {
    case 'not_listed':
      return 'The server does not list its models, so type the model id.';
    case 'unauthorised':
      return 'The server refused the API key.';
    case 'http_error':
      return `The server answered HTTP ${outcome.httpStatus}. Check the address.`;
    case 'invalid_payload':
      return 'The server answered, but not with a model list. Check the address and the provider type.';
    case 'timeout':
      return 'The server did not answer in time. Check the address and that it is running.';
    case 'unreachable':
      return 'The server could not be reached. Check the address and that it is running.';
    case 'invalid_url':
      return outcome.reason;
  }
}
