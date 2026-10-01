// ── Progression-model parameters ────────────────────────
//
// Each progression model (src/lib/routine/models) may take a few settings on the
// path that uses it. They are validated here, apart from the evaluators, so plan
// validation can run in any bundle without pulling the whole engine in.
//
//   variation   { }                                  double progression, then the next variation
//   load        { incrementKg?, regressPct? }        add weight when the top of the range is hit
//   percentage  { oneRepMaxKg? }                     block %1RM prescriptions; e1RM when omitted
//   volume      { metric?, maxWeeklyIncreasePct? }   weekly volume ramp (distance, time or sets)
//   maintain    { }                                  hold performance inside a range

import type { ProgressionModelId } from './types';

export interface ModelParamSpec {
  label: string;
  description: string;
  params: Record<string, { type: 'number' | 'enum'; min?: number; max?: number; values?: string[]; description: string }>;
}

export const MODEL_PARAM_SPECS: Record<ProgressionModelId, ModelParamSpec> = {
  variation: {
    label: 'Variation progression',
    description:
      'Double progression within a rep, hold or time range; once the marker is met for enough sessions, move to the next (harder) variation and build back up.',
    params: {},
  },
  load: {
    label: 'Load progression',
    description:
      'Keep the exercise and add weight once every working set reaches the top of the rep range inside the effort target.',
    params: {
      incrementKg: { type: 'number', min: 0.25, max: 50, description: 'Weight added per progression (default 2.5).' },
      regressPct: { type: 'number', min: 1, max: 50, description: 'Percent removed after repeated misses (default 10).' },
    },
  },
  percentage: {
    label: 'Percentage-based (periodized)',
    description:
      'Prescriptions come from the current block as a percent of the one-rep max; checks that the prescribed sets were completed.',
    params: {
      oneRepMaxKg: { type: 'number', min: 1, max: 1000, description: 'Tested one-rep max; estimated from sessions when omitted.' },
    },
  },
  volume: {
    label: 'Volume ramp',
    description:
      'Build weekly volume (distance, time or sets) toward a target without raising it faster than a set percentage per week; optional pace or heart-rate zone targets.',
    params: {
      metric: { type: 'enum', values: ['distanceM', 'durationS', 'sets'], description: 'What weekly volume counts (default distanceM).' },
      maxWeeklyIncreasePct: { type: 'number', min: 1, max: 50, description: 'Largest safe week-over-week increase (default 10).' },
    },
  },
  maintain: {
    label: 'Maintain',
    description: 'Hold performance inside the prescribed range; no advancement (mobility, skills, maintenance lifting).',
    params: {},
  },
};

/** Problems with a path's params, each phrased so a model can fix them. */
export function validateModelParams(model: ProgressionModelId, params: unknown, where: string): string[] {
  if (params === undefined || params === null) return [];
  if (typeof params !== 'object' || Array.isArray(params)) return [`${where}.params must be an object.`];
  const spec = MODEL_PARAM_SPECS[model];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    const p = spec.params[key];
    if (!p) {
      const allowed = Object.keys(spec.params);
      errors.push(
        `${where}.params.${key} is not a setting of the "${model}" model${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ' (it takes none)'}.`
      );
      continue;
    }
    if (p.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max)) {
        errors.push(`${where}.params.${key} must be a number between ${p.min} and ${p.max}.`);
      }
    } else if (!p.values?.includes(value as string)) {
      errors.push(`${where}.params.${key} must be one of ${p.values?.join(', ')}.`);
    }
  }
  return errors;
}

/** Read a numeric param with its default. */
export function numberParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
