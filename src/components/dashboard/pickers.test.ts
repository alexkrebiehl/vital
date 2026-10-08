import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DateSpec } from '@/lib/dashboard/types';
import { REF } from '@/lib/dashboard/synthetic-dataset.fake';
import { DateSpecPicker } from './DateSpecPicker';
import { MetricPicker } from './MetricPicker';

const count = (html: string, needle: string) => html.split(needle).length - 1;
const noop = () => {};

function metric(over: Partial<Parameters<typeof MetricPicker>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(MetricPicker, { value: null, onChange: noop, activeSources: undefined, hasData: () => true, ...over })
  );
}
function date(value: DateSpec) {
  return renderToStaticMarkup(createElement(DateSpecPicker, { value, onChange: noop, referenceKey: REF }));
}

describe('MetricPicker', () => {
  it('has a labelled search box', () => {
    const html = metric();
    expect(html).toContain('type="text"');
    expect(html).toMatch(/Search metrics/);
  });

  it('renders one fieldset and legend per category, in registry order', () => {
    const html = metric();
    expect(count(html, '<fieldset')).toBeGreaterThanOrEqual(5);
    expect(count(html, '<fieldset')).toBe(count(html, '<legend'));
    expect(html.indexOf('Cardiovascular')).toBeGreaterThan(-1);
    expect(html.indexOf('Cardiovascular')).toBeLessThan(html.indexOf('Activity'));
  });

  it('uses native radios that share one name', () => {
    const html = metric();
    const names = new Set([...html.matchAll(/<input[^>]*type="radio"[^>]*name="([^"]+)"/g)].map(m => m[1]));
    expect(count(html, 'type="radio"')).toBeGreaterThan(10);
    expect(names.size).toBe(1);
  });

  it('checks the chosen metric only', () => {
    const html = metric({ value: 'step_count' });
    expect(count(html, 'checked=""')).toBe(1);
    expect(html).toMatch(/value="step_count"[^>]*checked=""|checked=""[^>]*value="step_count"/);
  });

  it('marks a metric with no data, like Trends', () => {
    const html = metric({ hasData: id => id !== 'step_count' });
    expect(html).toContain('(no data)');
    expect(metric()).not.toContain('(no data)');
  });

  it('says so when nothing matches', () => {
    const html = metric({ initialQuery: 'zzzz' });
    expect(html).toContain('No metric matches “zzzz”.');
    expect(html).not.toContain('type="radio"');
  });
});

describe('DateSpecPicker', () => {
  it('offers Today, Yesterday and Date range, and shows the resolved label with its year', () => {
    const html = date({ kind: 'today' });
    expect(html).toContain('Today');
    expect(html).toContain('Yesterday');
    expect(html).toContain('Date range');
    expect(html).toContain('Today · Mar 10, 2026');
    expect(html).not.toContain('type="date"');
  });

  it('shows the yesterday label', () => {
    expect(date({ kind: 'yesterday' })).toContain('Yesterday · Mar 9, 2026');
  });

  it('range: two labelled dates capped at the reference day', () => {
    const html = date({ kind: 'range', start: '2026-03-01', end: '2026-03-07' });
    expect(count(html, 'type="date"')).toBe(2);
    expect(count(html, `max="${REF}"`)).toBe(2);
    expect(html).toContain('Start date');
    expect(html).toContain('End date');
    expect(html).toContain('value="2026-03-01"');
  });

  it('range: 7D, 30D and 90D quick picks', () => {
    const html = date({ kind: 'range', start: '2026-03-01', end: '2026-03-07' });
    for (const label of ['7D', '30D', '90D']) expect(html).toContain(`>${label}<`);
  });

  it('range: states the dates are fixed, with the years', () => {
    const html = date({ kind: 'range', start: '2026-03-01', end: '2026-03-07' });
    expect(html).toContain('This card will keep showing Mar 1 – Mar 7, 2026.');
  });

  it('range: an error is shown and wired to both inputs by aria-describedby', () => {
    const html = date({ kind: 'range', start: '2026-03-09', end: '2026-03-01' });
    const msg = 'The range start must be on or before its end.';
    expect(html).toContain(msg);
    const id = html.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
    expect(id).not.toBe('');
    expect(html).toContain(`id="${id}"`);
    expect(html.indexOf(msg)).toBeGreaterThan(html.indexOf(`id="${id}"`));
    expect(count(html, `aria-describedby="${id}"`)).toBe(2);
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('This card will keep showing');
  });

  it('range: no error markup when valid', () => {
    const html = date({ kind: 'range', start: '2026-03-01', end: '2026-03-07' });
    expect(html).not.toContain('aria-invalid');
  });
});
