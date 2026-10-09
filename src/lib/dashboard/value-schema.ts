// ── The `value` card type: one metric, one date spec, 1×1 ────────────────────
//
// docs/design/dashboard.md §4.2. Schema only; the renderer and editor are UI.
// This file must not import card-schemas at runtime (card-schemas registers it).

import { getMetric } from '@/lib/metrics/registry';
import type { AggregationStrategy } from '@/lib/metrics/types';
import type { CardTypeSchema } from './card-schemas';
import { validateDateSpec } from './date-spec';
import type { ValueCardSpec } from './types';

/** The strategies the value resolver can aggregate. A guard test fails if a metric uses another. */
export const SUPPORTED_VALUE_STRATEGIES: readonly AggregationStrategy[] = ['avg', 'sum', 'latest', 'min', 'max'];

export const valueSchema: CardTypeSchema<ValueCardSpec> = {
  type: 'value',
  version: 1,
  label: 'Value',
  sizes: [{ w: 1, h: 1 }],
  defaultSize: { w: 1, h: 1 },
  migrate: spec => spec,
  validate(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, errors: ['The card settings must be an object with a metric and a date.'] };
    }
    const obj = input as Record<string, unknown>;
    const errors: string[] = [];
    for (const key of Object.keys(obj)) {
      if (key !== 'metricId' && key !== 'date') errors.push(`The card settings have an unknown field "${key}".`);
    }

    const metricId = obj.metricId;
    if (typeof metricId !== 'string' || metricId === '') {
      errors.push('Choose a metric.');
    } else {
      const metric = getMetric(metricId);
      if (!metric) errors.push(`There is no metric "${metricId}".`);
      else if (!SUPPORTED_VALUE_STRATEGIES.includes(metric.aggregationStrategy)) {
        errors.push(`${metric.displayName} cannot be shown as a single value.`);
      }
    }

    const date = validateDateSpec(obj.date);
    if (!date.ok) errors.push(...date.errors);

    if (errors.length || !date.ok) return { ok: false, errors };
    return { ok: true, spec: { metricId: metricId as string, date: date.spec } };
  },
};
