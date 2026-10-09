// ── The blood pressure chart draws BOTH numbers of every reading ────────────
//
// Owner report: with 111/71 mmHg "the chart only displays 111". The paired chart
// draws a systolic line, a diastolic line and a soft band between them, a marker
// on every reading, and one tooltip that states both numbers. Fixtures are
// synthetic. recharts measures its container, which a server render cannot do,
// so the container is given a fixed size below (as the lab chart test does).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BloodPressureObservation } from '@/lib/metrics/types';
import {
  BloodPressureChart,
  BloodPressureDataTable,
  BloodPressureTooltipBody,
  bloodPressureChartRows,
  bloodPressureTooltipModel,
} from './BloodPressureChart';

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 280 } as never),
  };
});

function reading(date: string, systolic: number, diastolic: number): BloodPressureObservation {
  return { date, systolic, diastolic, units: 'mmHg', source: 'test cuff' };
}

const ONE = [reading('2026-09-10', 111, 71)];
const TWO_SAME_DAY = [reading('2026-09-10', 111, 71), reading('2026-09-10', 125, 82), reading('2026-09-12', 118, 76)];

const h = React.createElement as (type: unknown, props: unknown) => React.ReactElement;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('bloodPressureChartRows', () => {
  it('gives every reading its own row, in order, with both numbers and the band between them', () => {
    const rows = bloodPressureChartRows(TWO_SAME_DAY);
    expect(rows.map(r => [r.date, r.systolic, r.diastolic])).toEqual([
      ['2026-09-10', 111, 71],
      ['2026-09-10', 125, 82],
      ['2026-09-12', 118, 76],
    ]);
    expect(rows.map(r => r.range)).toEqual([[71, 111], [82, 125], [76, 118]]);
    expect(new Set(rows.map(r => r.id)).size).toBe(3);
  });

  it('drops a reading that lacks either number rather than drawing half of it', () => {
    const rows = bloodPressureChartRows([...ONE, { ...reading('2026-09-11', 120, 80), diastolic: Number.NaN }]);
    expect(rows).toHaveLength(1);
  });
});

describe('tooltip content', () => {
  it('for one reading: full date, 111/71 mmHg, and both numbers named beneath', () => {
    const rows = bloodPressureChartRows(ONE);
    const html = renderToStaticMarkup(h(BloodPressureTooltipBody, { model: bloodPressureTooltipModel(rows, rows[0].id)! }));
    expect(text(html)).toContain('Sep 10, 2026');
    expect(text(html)).toContain('111/71 mmHg');
    expect(text(html)).toContain('Systolic 111 · Diastolic 71');
  });

  it('for two readings on one day: each is its own row, in time order, never averaged', () => {
    const rows = bloodPressureChartRows(TWO_SAME_DAY);
    const model = bloodPressureTooltipModel(rows, rows[1].id)!;
    expect(model.entries.map(e => e.pair)).toEqual(['111/71 mmHg', '125/82 mmHg']);
    expect(model.entries.map(e => e.hovered)).toEqual([false, true]);
    const t = text(renderToStaticMarkup(h(BloodPressureTooltipBody, { model })));
    expect(t.indexOf('111/71 mmHg')).toBeGreaterThan(-1);
    expect(t.indexOf('125/82 mmHg')).toBeGreaterThan(t.indexOf('111/71 mmHg'));
    expect(t).not.toContain('118/76');
    expect(t).not.toContain('118/77');
  });

  it('is null for a position that is not a reading', () => {
    expect(bloodPressureTooltipModel(bloodPressureChartRows(ONE), 'nope')).toBeNull();
  });
});

describe('the chart', () => {
  const html = renderToStaticMarkup(h(BloodPressureChart, { records: TWO_SAME_DAY, height: 280 }));

  it('draws a systolic line, a diastolic line and the band between them', () => {
    expect((html.match(/class="recharts-layer recharts-line"/g) ?? []).length).toBe(2);
    expect(html).toContain('recharts-area');
  });

  it('marks every reading on both lines', () => {
    expect((html.match(/class="recharts-dot recharts-line-dot"/g) ?? []).length).toBe(2 * TWO_SAME_DAY.length);
  });

  it('describes both numbers of the range for assistive technology', () => {
    const label = /aria-label="([^"]*)"/.exec(html)![1];
    expect(label).toContain('Systolic 111 to 125');
    expect(label).toContain('diastolic 71 to 82');
  });
});

describe('BloodPressureDataTable', () => {
  const html = renderToStaticMarkup(h(BloodPressureDataTable, { records: TWO_SAME_DAY }));

  it('has a Systolic column and a Diastolic column, not a single value', () => {
    expect(html).toContain('>Systolic<');
    expect(html).toContain('>Diastolic<');
    expect(html).not.toContain('>Value<');
  });

  it('lists every reading, both numbers each', () => {
    const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m => text(m[1])).slice(1);
    expect(rows).toEqual([
      expect.stringContaining('111 71 mmHg'),
      expect.stringContaining('125 82 mmHg'),
      expect.stringContaining('118 76 mmHg'),
    ]);
  });
});
