import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardGrid, type GridItem } from './DashboardGrid';

const item = (id: string, describe = `Card ${id}`): GridItem => ({
  id,
  size: { w: 1, h: 1 },
  describe,
  render: ({ handle }) => createElement('div', { 'data-body': id }, handle, id.toUpperCase()),
});

const render = (items: GridItem[], arrange = true) =>
  renderToStaticMarkup(createElement(DashboardGrid, { items, onReorder: arrange ? () => {} : undefined }));

describe('DashboardGrid', () => {
  it('renders the cards in the order given, in DOM order', () => {
    const html = render([item('c'), item('a'), item('b')]);
    const order = [...html.matchAll(/data-body="(\w)"/g)].map(m => m[1]);
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('server-renders without error, and twice gives the same markup (stable ids)', () => {
    const items = [item('a'), item('b')];
    expect(render(items)).toBe(render(items));
  });

  it('gives each card a handle: a button named by the card, with a roledescription, and nothing else draggable', () => {
    const html = render([item('a', 'Steps, today'), item('b', 'Weight, yesterday')]);
    expect(html).toContain('aria-label="Move Steps, today"');
    expect(html).toContain('aria-label="Move Weight, yesterday"');
    expect(html.match(/aria-roledescription="sortable"/g)).toHaveLength(2);
    expect(html.match(/touch-action:none/g)).toHaveLength(2);
    expect(html).toMatch(/<button type="button" aria-label="Move Steps, today"/);
    expect(html).not.toMatch(/<li[^>]*aria-roledescription/);
    expect(html).not.toMatch(/<li[^>]*touch-action/);
  });

  it('has no handles and no drag attributes without onReorder', () => {
    const html = render([item('a'), item('b')], false);
    expect(html).not.toContain('aria-label="Move ');
    expect(html).not.toContain('aria-roledescription');
    expect(html).toContain('aria-label="Dashboard cards"');
  });

  it('spans a card by its size', () => {
    const html = renderToStaticMarkup(
      createElement(DashboardGrid, {
        items: [{ ...item('a'), size: { w: 2, h: 1 } }],
        onReorder: () => {},
      })
    );
    expect(html).toContain('lg:col-span-2');
  });
});
