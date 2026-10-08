import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { REF, install, obs } from '@/lib/dashboard/synthetic-dataset.fake';
import type { CardRecord } from '@/lib/dashboard/types';
import { DashboardView } from './DashboardView';
import { initialDashboardState, type DashboardState } from './dashboard-state';

const context = { referenceKey: REF, system: 'metric' as const };
const ADD = createElement('button', { type: 'button' }, 'Add card');

function card(id: string, over: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    type: 'value',
    spec: { metricId: 'step_count', date: { kind: 'yesterday' } },
    schemaVersion: 1,
    layout: { w: 1, h: 1, order: 0 },
    revision: 1,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
    status: 'ok',
    ...over,
  };
}

const render = (state: DashboardState, extra: Partial<Parameters<typeof DashboardView>[0]> = {}) =>
  renderToStaticMarkup(createElement(DashboardView, { state, context, onRetry: () => {}, addAction: ADD, ...extra }));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const ready = (cards: CardRecord[], notice: string | null = null): DashboardState => ({
  status: 'ready', cards, error: null, notice,
});

afterEach(() => resetToDemoDataset());

describe('DashboardView', () => {
  it('loading: the header and three skeleton cards, no values', () => {
    const html = render(initialDashboardState);
    expect(html).toContain('Dashboard');
    expect(count(html, 'animate-pulse')).toBeGreaterThanOrEqual(3);
    expect(html).toContain('Loading');
    expect(html).not.toContain('<article');
  });

  it('503: says no database is configured, with the server’s reason, and no retry', () => {
    const html = render({
      status: 'error', cards: [], notice: null,
      error: { message: 'Set DATABASE_URL to store dashboard cards.', httpStatus: 503 },
    });
    expect(html).toContain('The dashboard is stored in the database, and no database is configured.');
    expect(html).toContain('Set DATABASE_URL to store dashboard cards.');
    expect(html).not.toContain('Try again');
  });

  it('any other error: the message and a way to retry', () => {
    const html = render({
      status: 'error', cards: [], notice: null,
      error: { message: 'The dashboard could not be read.', httpStatus: 500 },
    });
    expect(html).toContain('The dashboard could not be read.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('is stored in the database');
  });

  it('empty: "No cards yet", the sentence, and the add action once', () => {
    const html = render(ready([]));
    expect(html).toContain('No cards yet');
    expect(html).toContain('Add a card for any metric, for today, yesterday or a date range.');
    expect(count(html, '>Add card<')).toBe(1);
    expect(html).not.toContain('<article');
  });

  it('cards: one article per card in order, the add action in the header, no seeded cards', () => {
    install({ step_count: [obs('2026-03-09', 5000)], resting_heart_rate: [obs('2026-03-09', 61)] });
    const html = render(
      ready([
        card('card-1'),
        card('card-2', { spec: { metricId: 'resting_heart_rate', date: { kind: 'yesterday' } } }),
      ])
    );
    expect(count(html, '<article')).toBe(2);
    expect(html.indexOf('data-card-id="card-1"')).toBeLessThan(html.indexOf('data-card-id="card-2"'));
    expect(html).toContain('5.0K');
    expect(count(html, '>Add card<')).toBe(1);
    expect(html).not.toContain('No cards yet');
  });

  it('a card with no reading still shows its place, with the reason', () => {
    install({ step_count: [obs('2026-03-05', 4000)] });
    const html = render(ready([card('card-1')]));
    expect(html).toContain('No reading');
    expect(html).toContain('No Steps reading on Mar 9, 2026.');
  });

  it('an unreadable card or an unknown type renders the shell with its problem', () => {
    const html = render(
      ready([
        card('card-1', { status: 'unreadable', spec: null, problem: 'This card was saved by a newer version of Vital.' }),
        card('card-2', { type: 'chart' }),
      ])
    );
    expect(count(html, '<article')).toBe(2);
    expect(html).toContain('This card was saved by a newer version of Vital.');
    expect(html).toContain('This card’s type is not part of this version of Vital.');
  });

  it('shows a notice about a change that did not go through', () => {
    expect(render(ready([], 'That change was not saved.'))).toContain('That change was not saved.');
  });

  it('puts the slots of D4/D5 on each card when given', () => {
    install({ step_count: [obs('2026-03-09', 5000)] });
    const html = render(ready([card('card-1')]), {
      actionsFor: () => [{ id: 'remove', label: 'Remove', onSelect: () => {} }],
      handleFor: () => createElement('button', { 'aria-label': 'Move Steps' }, 'grip'),
    });
    expect(html).toContain('Options for Steps');
    expect(html).toContain('aria-label="Move Steps"');
  });

  it('prints no source names and no assessment words', () => {
    install({ step_count: [obs('2026-03-09', 5000)] });
    const html = render(ready([card('card-1')]));
    expect(html).not.toMatch(/Apple|Oura|Hevy|HAE|Health Auto Export/i);
    expect(html).not.toMatch(/\b(good|bad|healthy|score|normal|excellent|poor)\b/i);
  });
});
