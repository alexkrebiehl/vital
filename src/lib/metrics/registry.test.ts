import { describe, expect, it } from 'vitest';

import { getAllMetrics, getMetric } from './registry';

// ── Every metric opens on a 30-day window ────────────────
//
// The app briefly defaulted several metrics and pages to 90 days or a year,
// which showed sparse, mostly-empty charts because the history is shorter than
// the window (a year of data does not exist yet for most metrics). 30 days is
// the window the product promises by default; longer ranges stay selectable.
//
// This is a product decision, not a detail: if a future metric needs a different
// default, change this test deliberately rather than letting one metric drift.

describe('metric default ranges', () => {
  it('defaults every metric to a 30-day window', () => {
    const wrong = getAllMetrics()
      .filter(m => m.defaultRange !== '30d')
      .map(m => `${m.id}: ${m.defaultRange}`);

    expect(wrong).toEqual([]);
  });

  it('has metrics to check, so the assertion above cannot pass vacuously', () => {
    expect(getAllMetrics().length).toBeGreaterThan(20);
  });

  it('still offers longer ranges as choices, they are just not the default', () => {
    // The default is not a cap: the detail page's range control keeps 90D, 1Y
    // and All selectable.
    const ranges = new Set(getAllMetrics().map(m => m.defaultRange));
    expect(ranges.has('30d')).toBe(true);
  });
});

// ── Ring-only metrics ────────────────────────────────────
//
// Three measures only a ring records. They are not the watch's HRV, resting
// heart rate or wrist temperature, so they get their own ids, and no display
// name says where they come from (data-source names belong on Settings only).

describe('ring-only metrics', () => {
  const ids = ['hrv_rmssd_sleep', 'lowest_heart_rate_sleep', 'temperature_deviation'];

  it('registers all three with no demo data and a neutral reason', () => {
    for (const id of ids) {
      const m = getMetric(id);
      expect(m, id).toBeDefined();
      expect(m!.demoAvailable).toBe(false);
      expect(m!.unavailableReason).toBe('Recorded by a connected ring');
      expect(`${m!.displayName} ${m!.aliases.join(' ')} ${m!.unavailableReason}`).not.toMatch(/oura/i);
    }
  });

  it('declares the specified names, units and aggregation', () => {
    expect(getMetric('hrv_rmssd_sleep')).toMatchObject({
      displayName: 'Overnight HRV (RMSSD)', category: 'cardiovascular', canonicalUnit: 'ms',
      decimalPlaces: 0, aggregationStrategy: 'avg',
    });
    expect(getMetric('lowest_heart_rate_sleep')).toMatchObject({
      displayName: 'Lowest Overnight Heart Rate', category: 'cardiovascular', canonicalUnit: 'bpm',
      decimalPlaces: 0, aggregationStrategy: 'avg',
    });
    expect(getMetric('temperature_deviation')).toMatchObject({
      displayName: 'Temperature Deviation', category: 'recovery', canonicalUnit: 'degC', decimalPlaces: 2,
    });
  });

  it('shows the sign of a temperature deviation', () => {
    const f = getMetric('temperature_deviation')!.formatter;
    expect(f(0.21)).toBe('+0.21 °C');
    expect(f(-0.4)).toBe('-0.40 °C');
    expect(f(0)).toBe('0.00 °C');
  });
});
