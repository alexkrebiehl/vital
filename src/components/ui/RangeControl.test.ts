import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RangeControl } from './RangeControl';

const render = (props: Partial<Parameters<typeof RangeControl>[0]> = {}) =>
  renderToStaticMarkup(createElement(RangeControl, { value: '30', onChange: () => {}, ...props }));

describe('RangeControl', () => {
  it('offers 7, 30 and 90 days and a Custom range, in that order', () => {
    const html = render();
    const order = ['7D', '30D', '90D', 'Custom'].map(label => html.indexOf(`>${label}<`));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('marks the current preset as selected and shows no custom box', () => {
    const html = render({ value: '7' });
    expect(html).toMatch(/aria-selected="true"[^>]*>7D</);
    expect(html).not.toContain('type="number"');
  });

  it('shows a value outside the presets as Custom, with its box', () => {
    const html = render({ value: '45' });
    expect(html).toContain('Custom · 45D');
    expect(html).toContain('type="number"');
  });

  it('reads the token format used by the metric page', () => {
    expect(render({ value: '90d', format: 'token' })).toMatch(/aria-selected="true"[^>]*>90D</);
    expect(render({ value: '14d', format: 'token' })).toContain('Custom · 14D');
  });

  it('keeps page-specific extras after the presets without calling them custom', () => {
    const html = render({ value: 'all', extraOptions: [{ value: '365', label: '1Y' }, { value: 'all', label: 'All' }] });
    expect(html).toContain('>1Y<');
    expect(html).toMatch(/aria-selected="true"[^>]*>All</);
    expect(html).not.toContain('Custom ·');
  });
});
