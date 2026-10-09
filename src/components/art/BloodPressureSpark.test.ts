// ── The blood pressure sparkline draws two thin lines, never one ────────────

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BloodPressureSpark } from './BloodPressureSpark';

const h = React.createElement as (type: unknown, props: unknown) => React.ReactElement;
const pairs = (list: [number, number][]) => list.map(([systolic, diastolic]) => ({ systolic, diastolic }));

describe('BloodPressureSpark', () => {
  it('draws a systolic line and a diastolic line', () => {
    const html = renderToStaticMarkup(h(BloodPressureSpark, { readings: pairs([[111, 71], [118, 76], [125, 82]]) }));
    expect(html).toContain('data-series="systolic"');
    expect(html).toContain('data-series="diastolic"');
    expect((html.match(/<path[^>]*data-series/g) ?? []).length).toBe(2);
  });

  it('shares one scale, so the diastolic line sits below the systolic line', () => {
    const html = renderToStaticMarkup(h(BloodPressureSpark, { readings: pairs([[111, 71], [118, 76]]) }));
    const y = (series: string) => Number(new RegExp(`data-series="${series}"[^>]* d="M[\\d.]+ ([\\d.]+)`).exec(html)![1]);
    // SVG y grows downward: a larger y is lower on the page.
    expect(y('diastolic')).toBeGreaterThan(y('systolic'));
  });

  it('renders nothing for fewer than two readings rather than a flat line', () => {
    expect(renderToStaticMarkup(h(BloodPressureSpark, { readings: pairs([[111, 71]]) }))).toBe('');
  });

  it('ignores a reading that lacks either number', () => {
    const html = renderToStaticMarkup(
      h(BloodPressureSpark, { readings: [{ systolic: 111, diastolic: Number.NaN }, { systolic: 118, diastolic: 76 }] })
    );
    expect(html).toBe('');
  });
});
