// ── The analyst's configuration, from Settings (SERVER ONLY) ──
//
// Reads the current user's AI settings (or the injected ones) and builds the
// analyst configuration from the provider and model chosen for the Analyst.
// No choice: the demo analyst. Settings that could not be read: the demo
// configuration with the reason stated, so nothing is sent and the page says why.

import { readAiSettings, type AiSettingsDeps } from '@/lib/ai/settings';
import { selectionFor, type AiSettings } from '@/lib/ai/types';
import { buildAnalystConfig, unavailableAnalystConfig, type AnalystConfig } from './config';

export interface AnalystConfigDeps extends AiSettingsDeps {
  /** The settings to use instead of reading them (tests, and callers that already hold them). */
  aiSettings?: AiSettings;
}

export async function resolveAnalystConfig(deps: AnalystConfigDeps = {}): Promise<AnalystConfig> {
  const env = deps.env ?? process.env;
  const settings = deps.aiSettings ?? (await readAiSettings(deps));
  if (settings.unavailable) return unavailableAnalystConfig(settings.unavailable, env);
  return buildAnalystConfig(selectionFor(settings, 'analyst'), env);
}
