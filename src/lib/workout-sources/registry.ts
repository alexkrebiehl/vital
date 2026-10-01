// ── Workout-source registry ─────────────────────────────
//
// Adding a source is one folder under src/lib/workout-sources/<id>/ exporting a
// `WorkoutSourcePlugin`, plus one line here. Nothing else in Vital branches on a
// source id.

import { hevyPlugin } from './hevy';
import type { WorkoutSourcePlugin } from './types';

export const WORKOUT_SOURCE_PLUGINS: WorkoutSourcePlugin<any>[] = [hevyPlugin];

export interface EnabledSource {
  plugin: WorkoutSourcePlugin<any>;
  config: unknown;
}

/** Plugins whose configuration is present in this environment. */
export function enabledSources(env: NodeJS.ProcessEnv = process.env): EnabledSource[] {
  const out: EnabledSource[] = [];
  for (const plugin of WORKOUT_SOURCE_PLUGINS) {
    const config = plugin.readConfig(env);
    if (config) out.push({ plugin, config });
  }
  return out;
}

export const DEFAULT_SOURCE_LOOKBACK_DAYS = 400;

export function sourceLookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.WORKOUT_SOURCE_LOOKBACK_DAYS);
  return Number.isFinite(raw) && raw >= 7 && raw <= 3650 ? Math.round(raw) : DEFAULT_SOURCE_LOOKBACK_DAYS;
}
