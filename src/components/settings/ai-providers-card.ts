// ── Settings → Connections → AI providers: state and the calls ──────────
//
// Pure helpers behind the card. Nothing here keeps a key: `saveAiProvider`
// takes it as an argument, puts it in the request body and returns only the
// server's answer, which never holds a key.

import type { AiProvidersBody, AiProviderStatus } from '@/lib/ai/connect';
import type { AiProviderKind } from '@/lib/ai/types';

export type { AiProvidersBody, AiProviderStatus };

export const AI_PROVIDERS_PATH = '/api/ai/providers';

/** Hosts that stay on this machine, so a key is optional (mirrors the server's LOOPBACK_HOSTS). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal']);

/** Plain starting points for the address field. The person can type any other. */
export const ADDRESS_HINTS: { label: string; kind: AiProviderKind; url: string }[] = [
  { label: 'OpenAI', kind: 'openai', url: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', kind: 'openai', url: 'https://openrouter.ai/api/v1' },
  { label: 'LM Studio', kind: 'openai', url: 'http://host.docker.internal:1234/v1' },
  { label: 'Ollama', kind: 'openai', url: 'http://host.docker.internal:11434/v1' },
  { label: 'Anthropic', kind: 'anthropic', url: 'https://api.anthropic.com' },
];

/** The form's fields. `id` is null for a new provider. */
export interface AiProviderDraft {
  id: string | null;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  removeKey: boolean;
}

export function emptyDraft(): AiProviderDraft {
  return { id: null, name: '', kind: 'openai', baseUrl: '', apiKey: '', removeKey: false };
}

export function draftFor(provider: AiProviderStatus): AiProviderDraft {
  return { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, apiKey: '', removeKey: false };
}

/** Whether an address is on this machine. An unparseable one is not. */
export function isLocalAddress(baseUrl: string): boolean {
  try {
    return LOOPBACK.has(new URL(baseUrl.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether Save can be pressed. A key is needed for an address that is not on
 * this machine, unless the provider already has one stored (a blank key keeps it).
 */
export function canSaveDraft(draft: AiProviderDraft, stored: AiProviderStatus | null, available: boolean): boolean {
  if (!draft.name.trim() || !draft.baseUrl.trim()) return false;
  const typed = draft.apiKey.trim().length > 0;
  if (typed && !available) return false;
  if (isLocalAddress(draft.baseUrl)) return true;
  if (typed) return true;
  return Boolean(stored && stored.hasKey && !stored.needsReentry && !draft.removeKey);
}

export type SaveAiProviderResult =
  | { ok: true; body: AiProvidersBody; models: string[]; note: string | null }
  | { ok: false; message: string };

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { error?: unknown };
    if (typeof payload?.error === 'string') return payload.error;
  } catch {
    // fall through
  }
  return `${fallback} (HTTP ${res.status}).`;
}

/** POST a new provider, or PUT an existing one. A blank key is left out so the stored one is kept. */
export async function saveAiProvider(draft: AiProviderDraft, fetchImpl: typeof fetch = fetch): Promise<SaveAiProviderResult> {
  const body: Record<string, unknown> = { name: draft.name.trim(), kind: draft.kind, baseUrl: draft.baseUrl.trim() };
  if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
  if (draft.removeKey) body.removeKey = true;
  let res: Response;
  try {
    res = await fetchImpl(draft.id ? `${AI_PROVIDERS_PATH}/${encodeURIComponent(draft.id)}` : AI_PROVIDERS_PATH, {
      method: draft.id ? 'PUT' : 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'The provider could not be saved: Vital could not be reached.' };
  }
  if (!res.ok) return { ok: false, message: await errorOf(res, 'The provider could not be saved') };
  const payload = (await res.json()) as AiProvidersBody & { models?: string[]; note?: string | null };
  return { ok: true, body: payload, models: payload.models ?? [], note: payload.note ?? null };
}

export async function removeAiProvider(id: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetchImpl(`${AI_PROVIDERS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' });
    if (res.status === 204) return { ok: true };
    return { ok: false, message: await errorOf(res, 'The provider could not be removed') };
  } catch {
    return { ok: false, message: 'The provider could not be removed: Vital could not be reached.' };
  }
}
