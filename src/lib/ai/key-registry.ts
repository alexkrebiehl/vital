// ── Stored AI keys, for redaction (SERVER ONLY, no imports) ──
//
// Every API key read from or written to the AI settings is remembered here so
// `redactCredentials` (analyst/scrub.ts) can strip it from any text, exactly as
// it strips a credential set in the environment. This file imports nothing, so
// the scrubber can use it without pulling in the database layer.
//
// The set lives on globalThis: Next builds the server into several bundles, and
// a key read in one must be redacted in all of them.

const KEY = Symbol.for('vital.ai.keys');

function keys(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  if (!g[KEY]) g[KEY] = new Set();
  return g[KEY] as Set<string>;
}

/** Remember a key for redaction. */
export function rememberAiKey(apiKey: string | null | undefined): void {
  const trimmed = apiKey?.trim();
  if (trimmed) keys().add(trimmed);
}

/** Every AI key seen so far in this process. */
export function knownAiKeys(): string[] {
  return [...keys()];
}
