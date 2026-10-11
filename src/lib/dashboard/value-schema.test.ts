import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricDefinition } from '@/lib/metrics/types';

vi.mock('@/lib/metrics/registry', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/metrics/registry')>();
  return { ...original, getMetric: vi.fn(original.getMetric) };
});

import { getAllMetrics, getMetric } from '@/lib/metrics/registry';
import { SUPPORTED_VALUE_STRATEGIES, valueSchema } from './value-schema';
import { getCardSchema, validateCardInput } from './card-schemas';

const spec = (over: Record<string, unknown> = {}) => ({ metricId: 'resting_heart_rate', date: { kind: 'today' }, ...over });

beforeEach(() => vi.mocked(getMetric).mockClear());

describe('value card schema', () => {
  it('is the registered `value` type, version 1, 1×1 only', () => {
    expect(getCardSchema('value')).toBe(valueSchema);
    expect(valueSchema).toMatchObject({ type: 'value', version: 1, label: 'Value', sizes: [{ w: 1, h: 1 }], defaultSize: { w: 1, h: 1 } });
  });

  it('every registered metric has a strategy the value card can resolve (guard)', () => {
    for (const m of getAllMetrics()) {
      expect(SUPPORTED_VALUE_STRATEGIES, m.id).toContain(m.aggregationStrategy);
    }
  });

  it('accepts every registered metric with each date kind', () => {
    for (const m of getAllMetrics()) {
      expect(valueSchema.validate({ metricId: m.id, date: { kind: 'yesterday' } }).ok, m.id).toBe(true);
    }
    expect(valueSchema.validate(spec({ date: { kind: 'range', start: '2026-09-01', end: '2026-09-07' } })).ok).toBe(true);
  });

  it('returns the spec as given', () => {
    expect(valueSchema.validate(spec())).toEqual({ ok: true, spec: spec() });
  });

  it('refuses an unknown metric, naming it', () => {
    const r = valueSchema.validate(spec({ metricId: 'no_such_metric' }));
    expect(r).toEqual({ ok: false, errors: ['There is no metric "no_such_metric".'] });
  });

  it('refuses a metric whose strategy is count', () => {
    const real = getMetric('resting_heart_rate') as MetricDefinition;
    vi.mocked(getMetric).mockReturnValueOnce({ ...real, aggregationStrategy: 'count' });
    const r = valueSchema.validate(spec());
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors[0]).toMatch(/cannot be shown as a single value/);
  });

  it('refuses an extra field, a missing field and a non-object', () => {
    expect(valueSchema.validate(spec({ extra: 1 })).ok).toBe(false);
    expect(valueSchema.validate({ metricId: 'resting_heart_rate' }).ok).toBe(false);
    expect(valueSchema.validate({ date: { kind: 'today' } }).ok).toBe(false);
    for (const bad of [null, 'x', 4, []]) expect(valueSchema.validate(bad).ok).toBe(false);
  });

  it('refuses a non-string metric id without throwing', () => {
    expect(valueSchema.validate(spec({ metricId: 7 })).ok).toBe(false);
    expect(valueSchema.validate(spec({ metricId: '__proto__' })).ok).toBe(false);
  });

  it('refuses a bad date, passing on the date reason', () => {
    const r = valueSchema.validate(spec({ date: { kind: 'range', start: '2026-02-30', end: '2026-03-05' } }));
    expect(r.ok ? [] : r.errors.join(' ')).toMatch(/real calendar date/);
  });

  it('reports the metric and the date problem together', () => {
    const r = valueSchema.validate(spec({ metricId: 'nope', date: { kind: 'later' } }));
    expect(r.ok ? [] : r.errors).toHaveLength(2);
  });

  it('through validateCardInput: oversized spec and wrong size are refused', () => {
    expect(validateCardInput({ type: 'value', spec: spec({ metricId: 'x'.repeat(3000) }) }).ok).toBe(false);
    expect(validateCardInput({ type: 'value', spec: spec(), size: { w: 2, h: 2 } }).ok).toBe(false);
    expect(validateCardInput({ type: 'value', spec: spec(), size: { w: 1, h: 1 } }).ok).toBe(true);
  });
});
