// ── Injected AI settings (TESTS ONLY) ────────────────────
//
// Builds the `AiSettings` object every consumer accepts as `deps.aiSettings`,
// so a test chooses the provider and model a use runs on without a database.
// Imported only by *.test.ts files and test fakes.

import { parseOptions, type AiAssignment, type AiProviderKind, type AiProviderRecord, type AiSettings, type AiUse } from './types';

export interface UseSpec {
  baseUrl: string;
  model: string;
  kind?: AiProviderKind;
  apiKey?: string | null;
  name?: string;
  options?: Record<string, unknown>;
  /** Simulate a key written under another secret key. */
  needsReentry?: boolean;
}

const AT = '2026-10-11T00:00:00.000Z';

function provider(id: string, spec: UseSpec): AiProviderRecord {
  const apiKey = spec.needsReentry ? null : spec.apiKey === undefined ? 'test-key' : spec.apiKey;
  return {
    id,
    name: spec.name ?? id,
    kind: spec.kind ?? 'openai',
    baseUrl: spec.baseUrl,
    apiKey,
    keyState: spec.needsReentry ? 'needs_reentry' : apiKey ? 'ok' : 'none',
    updatedAt: AT,
    revision: 1,
  };
}

/** Settings with one provider per use given. */
export function aiSettingsFor(specs: Partial<Record<AiUse, UseSpec>>): AiSettings {
  const providers: AiProviderRecord[] = [];
  const assignments: AiAssignment[] = [];
  for (const [use, spec] of Object.entries(specs) as [AiUse, UseSpec | undefined][]) {
    if (!spec) continue;
    const id = `${use}-provider`;
    providers.push(provider(id, spec));
    assignments.push({ use, providerId: id, model: spec.model, options: parseOptions(use, spec.options ?? {}), updatedAt: AT, revision: 1 });
  }
  return { providers, assignments };
}

/** Settings whose Analyst runs on an OpenAI-compatible server at `baseUrl`. */
export function analystOn(baseUrl: string, options: Record<string, unknown> = {}, extra: Partial<UseSpec> = {}): AiSettings {
  return aiSettingsFor({ analyst: { baseUrl, model: 'm', apiKey: 'test-key', options, ...extra } });
}

/** No provider configured anywhere: the demo analyst and the computed summary. */
export const NO_AI: AiSettings = { providers: [], assignments: [] };
