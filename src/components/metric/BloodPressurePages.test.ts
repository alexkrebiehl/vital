// ── The blood pressure pages show BOTH numbers (owner's 111/71 example) ─────
//
// Owner report: "If my blood pressure is 111/71 mmHg, the chart only displays
// 111." The detail page and the Health page are rendered with synthetic
// readings and must state both numbers of every reading, and must not label a
// single systolic figure as blood pressure. Fixtures are synthetic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FIXTURES,
  REFERENCE_KEY,
  resetToDemoDataset,
  setActiveDataset,
} from '@/lib/adapters/dataset';
import { addDays } from '@/lib/analytics/windows';
import type { HealthFixtures } from '@/lib/metrics/types';

vi.mock('next/navigation', () => ({
  useParams: () => ({ metricId: 'blood_pressure' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/metric/blood_pressure',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

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

function install(readings: { date: string; systolic: number; diastolic: number }[]) {
  const dataset: HealthFixtures = {
    ...FIXTURES,
    metrics: {
      ...FIXTURES.metrics,
      blood_pressure: readings.map(r => ({ ...r, units: 'mmHg', source: 'test cuff' })),
    },
    coverage: {
      ...FIXTURES.coverage,
      blood_pressure: {
        firstObservation: readings[0]?.date ?? '',
        lastObservation: readings[readings.length - 1]?.date ?? '',
        observedDays: new Set(readings.map(r => r.date)).size,
        expectedDays: 181,
        samplingFrequency: 'sporadic',
        sourceNames: ['test cuff'],
      },
    },
  };
  setActiveDataset(dataset, { mode: 'demo' });
}

afterEach(() => resetToDemoDataset());

describe("the owner's example, 111/71 mmHg", () => {
  beforeEach(() => {
    install([
      { date: addDays(REFERENCE_KEY, -20), systolic: 109, diastolic: 68 },
      { date: addDays(REFERENCE_KEY, -3), systolic: 118, diastolic: 76 },
      { date: addDays(REFERENCE_KEY, -1), systolic: 111, diastolic: 71 },
    ]);
  });

  it('the detail page states 111/71 mmHg as the latest reading, not 111 alone', async () => {
    const { MetricDetailPage } = await import('./MetricDetailPage');
    const t = text(renderToStaticMarkup(h(MetricDetailPage)));
    expect(t).toContain('111/71 mmHg');
    expect(t).not.toMatch(/(^|[^/\d])111 mmHg/);
  });

  it('the detail page reports its averages and baseline as pairs', async () => {
    const { MetricDetailPage } = await import('./MetricDetailPage');
    const t = text(renderToStaticMarkup(h(MetricDetailPage)));
    // 7-day readings 118/76 and 111/71 average to 114.5/73.5, printed whole.
    expect(t).toMatch(/7-day average[^]*?(115|114)\/(74|73) mmHg/);
    expect(t).toMatch(/Average:\s*\d+\/\d+ mmHg/);
    expect(t).toMatch(/Min:\s*\d+\/\d+ mmHg/);
    expect(t).toMatch(/Max:\s*\d+\/\d+ mmHg/);
  });

  it('the detail page draws the paired chart with both numbers described', async () => {
    const { MetricDetailPage } = await import('./MetricDetailPage');
    const html = renderToStaticMarkup(h(MetricDetailPage));
    expect(html).toMatch(/aria-label="Blood pressure chart[^"]*Systolic 109 to 118[^"]*diastolic 68 to 76/);
    expect(html).toContain('data-series="systolic"');
    expect(html).toContain('data-series="diastolic"');
  });

  it('the Health page lists 111/71 mmHg and charts both series', async () => {
    const { HealthPage } = await import('@/components/domain/HealthPage');
    const html = renderToStaticMarkup(h(HealthPage));
    const t = text(html);
    expect(t).toContain('111/71 mmHg');
    expect(t).toContain('118/76 mmHg');
    expect(html).toMatch(/aria-label="Blood pressure chart[^"]*Systolic 111 to 118[^"]*diastolic 71 to 76/);
    // The 7-day window leaves the older reading out.
    expect(t).not.toContain('109/68 mmHg');
  });
});

describe('no readings', () => {
  it('the detail page shows no pair and no zero', async () => {
    install([]);
    const { MetricDetailPage } = await import('./MetricDetailPage');
    const t = text(renderToStaticMarkup(h(MetricDetailPage)));
    expect(t).not.toMatch(/\b0\/0\b/);
    expect(t).toMatch(/no chart are shown|No readings/i);
  });
});
