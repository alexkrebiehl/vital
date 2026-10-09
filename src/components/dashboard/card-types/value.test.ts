import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { getAllMetrics } from '@/lib/metrics';
import { REF, bp, dataset, install, night, obs } from '@/lib/dashboard/synthetic-dataset.fake';
import { setActiveDataset } from '@/lib/adapters/dataset';
import type { DateSpec, ValueCardSpec } from '@/lib/dashboard/types';
import { valueCardUi } from './value';
import { getCardUi } from './index';

const ctx = { referenceKey: REF, system: 'metric' as const };
const SIZE = { w: 1, h: 1 };

function render(metricId: string, date: DateSpec) {
  const spec: ValueCardSpec = { metricId, date };
  const data = valueCardUi.resolve(spec, ctx);
  const html = renderToStaticMarkup(createElement(valueCardUi.Card, { spec, data, size: SIZE }));
  return { data, html };
}
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

afterEach(() => resetToDemoDataset());

describe('card type registry', () => {
  it('looks up the value type, and nothing for an unknown one', () => {
    expect(getCardUi('value')).toBe(valueCardUi);
    expect(getCardUi('chart')).toBeUndefined();
  });
  it('describes a card for assistive technology', () => {
    expect(valueCardUi.describe({ metricId: 'step_count', date: { kind: 'today' } })).toBe('Steps, today');
    expect(valueCardUi.describe({ metricId: 'step_count', date: { kind: 'yesterday' } })).toBe('Steps, yesterday');
    expect(valueCardUi.describe({ metricId: 'step_count', date: { kind: 'range', start: '2026-03-01', end: '2026-03-07' } })).toBe(
      'Steps, Mar 1 – Mar 7, 2026'
    );
    expect(valueCardUi.describe({ metricId: 'nope', date: { kind: 'today' } })).toBe('nope, today');
  });
  it('gives the shell a title, a metric for its colour and a date label', () => {
    install({ step_count: [obs('2026-03-10', 3000)] });
    const spec: ValueCardSpec = { metricId: 'step_count', date: { kind: 'today' } };
    expect(valueCardUi.heading(spec, valueCardUi.resolve(spec, ctx))).toEqual({
      title: 'Steps',
      metricId: 'step_count',
      dateLabel: 'Today · Mar 10, 2026',
    });
    const unknown: ValueCardSpec = { metricId: 'nope', date: { kind: 'today' } };
    expect(valueCardUi.heading(unknown, valueCardUi.resolve(unknown, ctx))).toEqual({ title: 'nope' });
  });
});

describe('ValueCard', () => {
  it('a value: headline in tabular figures, qualifier, detail, note, decorative sparkline, detail link', () => {
    install({ step_count: [obs('2026-03-05', 4000), obs('2026-03-06', 6000), obs('2026-03-10', 3000)] });
    const { data, html } = render('step_count', { kind: 'range', start: '2026-03-05', end: '2026-03-10' });
    if (data.state !== 'value') throw new Error('expected a value');
    expect(html).toMatch(new RegExp(`class="[^"]*tnum[^"]*"[^>]*>${escape(data.headline)}<`));
    expect(html).toContain(data.qualifier);
    expect(html).toContain(escape(data.detail ?? ''));
    expect(html).toContain(data.note ?? '');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('href="/metric/step_count"');
    expect(html).toContain('Open detail');
  });

  it('blood pressure draws the pair sparkline, never one line', () => {
    install({ blood_pressure: [bp('2026-03-08', 118, 76), bp('2026-03-09', 111, 71), bp('2026-03-10', 125, 82)] });
    const { html } = render('blood_pressure', { kind: 'range', start: '2026-03-01', end: '2026-03-10' });
    expect(html).toContain('data-series="systolic"');
    expect(html).toContain('data-series="diastolic"');
    expect(html).toContain('125/82 mmHg');
  });

  it('a single day and sleep have no sparkline', () => {
    install({ step_count: [obs('2026-03-10', 3000)], sleep_analysis: [night('2026-03-09', 400, 450), night('2026-03-10', 420, 460)] });
    expect(render('step_count', { kind: 'today' }).html).not.toContain('<svg');
    expect(render('sleep_analysis', { kind: 'range', start: '2026-03-01', end: '2026-03-10' }).html).not.toContain('<svg');
  });

  it('no reading keeps its place: title "No reading", the reason, and the detail link', () => {
    install({ step_count: [obs('2026-03-05', 4000)] });
    const { html } = render('step_count', { kind: 'yesterday' });
    expect(html).toContain('No reading');
    expect(html).toContain('No Steps reading on Mar 9, 2026.');
    expect(html).toContain('href="/metric/step_count"');
    expect(html).not.toContain('tnum');
  });

  it('unavailable: title "Not available" and the reason', () => {
    install({});
    const { data, html } = render('step_count', { kind: 'today' });
    expect(data.state).toBe('unavailable');
    expect(html).toContain('Not available');
    if (data.state === 'unavailable') expect(html).toContain(escape(data.reason));
  });

  it('unknown metric: "Not available", the reason, and no link to a page that does not exist', () => {
    install({});
    const { html } = render('not_a_metric', { kind: 'today' });
    expect(html).toContain('Not available');
    expect(html).toContain('This metric is not part of this version of Vital.');
    expect(html).not.toContain('/metric/');
  });
});

describe('guard: no zero for missing data, a reason instead', () => {
  const specs: DateSpec[] = [
    { kind: 'today' },
    { kind: 'yesterday' },
    { kind: 'range', start: '2026-03-01', end: '2026-03-09' },
    { kind: 'range', start: '2026-03-11', end: '2026-03-14' },
  ];
  // Matches a bare zero as an element's whole text or as a leading value ("0 steps").
  const bareZero = />0</;
  const zeroValue = />0\s/;

  function populatedLongAgo() {
    const metrics: Record<string, unknown[]> = {};
    for (const m of getAllMetrics()) {
      if (m.id === 'blood_pressure') metrics[m.id] = [bp('2026-01-15', 118, 76)];
      else if (m.id === 'sleep_in_bed') continue; // derived from the sleep record
      else if (m.id === 'sleep_analysis') metrics[m.id] = [night('2026-01-15', 400, 450)];
      else metrics[m.id] = [obs('2026-01-15', 42)];
    }
    setActiveDataset({ ...dataset(), metrics: metrics as never }, { mode: 'demo' });
  }

  it.each(['empty', 'populated long ago'])('every registered metric, %s', which => {
    if (which === 'empty') install({});
    else populatedLongAgo();
    for (const m of getAllMetrics()) {
      for (const date of specs) {
        const { data, html } = render(m.id, date);
        expect(data.state, `${m.id} ${date.kind}`).not.toBe('value');
        const reason = 'reason' in data ? data.reason : '';
        expect(reason.length, `${m.id} ${date.kind} has a reason`).toBeGreaterThan(0);
        expect(html).toContain(escape(reason));
        expect(html).not.toMatch(bareZero);
        expect(html).not.toMatch(zeroValue);
      }
    }
  });
});
