// ── AI settings: the one read path (SERVER ONLY) ─────────
//
// Every consumer (the analyst, the briefing, the training notes, the lab second
// pass) reads one user's AI configuration through `readAiSettings`, or is handed
// an `AiSettings` object directly (`deps.aiSettings`, the test seam).
//
// No database configured: there is nothing stored, so every use has no model
// (the demo analyst, the computed summary). A database that is configured but
// fails: `unavailable` says so, and the consumers report it instead of quietly
// behaving as if nothing were configured. A short in-process cache keeps the
// per-request cost to one query every 20 s; every write drops that user's entry.
//
// Keys read here are remembered (./key-registry) so `redactCredentials` can
// strip a stored key from any text, exactly as it strips a credential set in
// the environment.

import { getPool, type PoolLike } from '@/lib/db/pool';
import { listAssignments, listProviders } from '@/lib/db/ai-store';
import { currentUserId } from '@/lib/identity/current-user';
import { readSecretKey } from '@/lib/secrets/crypto';
import { rememberAiKey } from './key-registry';
import type { AiSettings } from './types';

/** How long a read is reused. Every write drops it at once. */
export const AI_SETTINGS_CACHE_MS = 20_000;

export interface AiSettingsDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  aiClient?: PoolLike | null;
  /** The user whose settings are read. Defaults to the current user. */
  userId?: string;
  now?: () => number;
}

export const EMPTY_AI_SETTINGS: AiSettings = { providers: [], assignments: [] };

interface Entry {
  at: number;
  value: AiSettings;
}

interface Globals {
  cache: WeakMap<object, Map<string, Entry>>;
}

const GLOBALS_KEY = Symbol.for('vital.ai.settings');

function globals(): Globals {
  const g = globalThis as unknown as Record<symbol, Globals | undefined>;
  if (!g[GLOBALS_KEY]) g[GLOBALS_KEY] = { cache: new WeakMap() };
  return g[GLOBALS_KEY] as Globals;
}

/** The pool, or null when there is no database or its settings are invalid. */
export function aiClientFor(deps: AiSettingsDeps = {}): PoolLike | null {
  if (deps.aiClient !== undefined) return deps.aiClient;
  try {
    return getPool(deps.env ?? process.env);
  } catch {
    return null;
  }
}

/** Drop the cached read of the user `deps` names, on the client `deps` names. Called by every write. */
export function clearAiSettingsCache(deps: AiSettingsDeps = {}): void {
  const client = aiClientFor(deps);
  if (client) globals().cache.get(client)?.delete(deps.userId ?? currentUserId());
}

/** Test seam: forget every cached read. */
export function resetAiSettingsCache(): void {
  globals().cache = new WeakMap();
}

/** One user's AI configuration. Never throws. */
export async function readAiSettings(deps: AiSettingsDeps = {}): Promise<AiSettings> {
  const client = aiClientFor(deps);
  if (!client) return EMPTY_AI_SETTINGS;
  const userId = deps.userId ?? currentUserId();
  const now = (deps.now ?? Date.now)();
  const g = globals();
  const perClient = g.cache.get(client) ?? new Map<string, Entry>();
  const hit = perClient.get(userId);
  if (hit && now - hit.at < AI_SETTINGS_CACHE_MS) return hit.value;

  let value: AiSettings;
  try {
    const key = readSecretKey(deps.env ?? process.env);
    const [providers, assignments] = await Promise.all([
      listProviders(client, userId, key),
      listAssignments(client, userId),
    ]);
    value = { providers, assignments };
  } catch {
    // Not cached: the next request tries again.
    return { ...EMPTY_AI_SETTINGS, unavailable: 'The AI settings could not be read from the database.' };
  }
  for (const provider of value.providers) rememberAiKey(provider.apiKey);
  perClient.set(userId, { at: now, value });
  g.cache.set(client, perClient);
  return value;
}
