// ── Trends: blood pressure is compared and charted as a pair ────────────────
//
// A selected metric used to be dropped from the Trends comparison when it was
// blood pressure (it had no single series), or would have shown its systolic
// number alone. It is now charted with both lines and compared per series.
// Synthetic fixtures.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIXTURES, REFERENCE_KEY, metricObservationsInWindow, resetToDemoDataset, setActiveDataset } from '@/lib/adapters/dataset';
import { addDays, trailingWindow, previousWindow } from '@/lib/analytics/windows';
import { BloodPressureAligned, BloodPressureComparison } from './BloodPressureCompare';
import { MetricTile } from './DomainShared';
import { getMetric } from '@/lib/metrics';

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 280 } as never),
  };
});

const h = React.createElement as (type: unknown, props?: unknown) => React.ReactElement;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  const readings = [
    [-12, 110, 70], [-9, 114, 74], [-5, 118, 76], [-2, 112, 72],
  ].map(([d, systolic, diastolic]) => ({
    date: addDays(REFERENCE_KEY, d), systolic, diastolic, units: 'mmHg', source: 'test cuff',
  }));
  setActiveDataset(
    {
      ...FIXTURES,
      metrics: { ...FIXTURES.metrics, blood_pressure: readings },
      coverage: {
        ...FIXTURES.coverage,
        blood_pressure: {
          firstObservation: readings[0].date, lastObservation: readings[3].date, observedDays: 4, expectedDays: 181,
          samplingFrequency: 'sporadic', sourceNames: ['test cuff'],
        },
      },
    },
    { mode: 'demo' }
  );
});
afterEach(() => resetToDemoDataset());

const THIS = () => trailingWindow(REFERENCE_KEY, 7);
const BEFORE = () => previousWindow(THIS(), 7, 'Previous 7 days');

describe('observations in a window', () => {
  it('counts blood pressure readings, which have no single series', () => {
    expect(metricObservationsInWindow('blood_pressure', THIS())).toBe(2);
    expect(metricObservationsInWindow('blood_pressure', BEFORE())).toBe(2);
    expect(metricObservationsInWindow('resting_heart_rate', THIS())).toBeGreaterThan(0);
  });
});

describe('BloodPressureComparison', () => {
  it('compares systolic and diastolic separately, never one number', () => {
    const t = text(renderToStaticMarkup(h(BloodPressureComparison, { evaluated: THIS(), comparator: BEFORE(), units: 'metric' })));
    // this week: 118/76 and 112/72 → 115/74; the week before: 110/70 and 114/74 → 112/72
    expect(t).toMatch(/Systolic\s+115 mmHg\s+112 mmHg\s+\+3 mmHg\s+2 vs 2/);
    expect(t).toMatch(/Diastolic\s+74 mmHg\s+72 mmHg\s+\+2 mmHg\s+2 vs 2/);
  });

  it('renders nothing when neither period has a reading', () => {
    const empty = { startKey: '2001-01-01', endKey: '2001-01-07', label: 'none' };
    expect(renderToStaticMarkup(h(BloodPressureComparison, { evaluated: empty, comparator: empty, units: 'metric' }))).toBe('');
  });
});

describe('BloodPressureAligned', () => {
  it('draws both series for the shared window', () => {
    const html = renderToStaticMarkup(h(BloodPressureAligned, { window: THIS(), units: 'metric', showXAxis: true }));
    expect(html).toMatch(/aria-label="Blood pressure chart[^"]*Systolic 112 to 118[^"]*diastolic 72 to 76/);
  });

  it('renders nothing for a window with no reading', () => {
    const empty = { startKey: '2001-01-01', endKey: '2001-01-07', label: 'none' };
    expect(renderToStaticMarkup(h(BloodPressureAligned, { window: empty, units: 'metric', showXAxis: true }))).toBe('');
  });
});

describe('MetricTile for blood pressure', () => {
  it('shows the latest reading as a pair with a two-line sparkline', () => {
    const html = renderToStaticMarkup(h(MetricTile, { metric: getMetric('blood_pressure')!, days: 30 }));
    expect(text(html)).toContain('112/72 mmHg');
    expect(html).toContain('data-series="systolic"');
    expect(html).toContain('data-series="diastolic"');
    expect(text(html)).toContain('4 readings');
  });
});
