import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardShell, type CardAction } from './CardShell';

const render = (props: Partial<Parameters<typeof CardShell>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(CardShell, { title: 'Steps', metricId: 'step_count', actions: [], ...props }, createElement('p', null, 'BODY'))
  );

const action = (id: string, label: string, danger = false): CardAction => ({ id, label, onSelect: () => {}, danger });

describe('CardShell', () => {
  it('is an article named by its title', () => {
    const html = render({ dateLabel: 'Today · Mar 10, 2026' });
    const labelledBy = /<article[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toMatch(new RegExp(`id="${labelledBy}"[^>]*>Steps<`));
    expect(html).toContain('Today · Mar 10, 2026');
    expect(html).toContain('BODY');
  });

  it('carries the category colour of its metric', () => {
    expect(render()).toContain('var(--color-category-activity)');
    expect(render({ metricId: 'sleep_analysis' })).toContain('var(--color-category-sleep)');
    expect(render({ metricId: undefined })).toContain('var(--color-accent)');
  });

  it('renders no options button when there are no actions', () => {
    const html = render();
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('Options for');
  });

  it('renders an always-visible options button when there are actions', () => {
    const html = render({ actions: [action('edit', 'Edit'), action('remove', 'Remove', true)] });
    expect(html).toContain('aria-label="Options for Steps"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/opacity-0|group-hover:opacity|invisible|hidden group/);
  });

  it('renders the handle slot', () => {
    expect(render({ handle: createElement('button', { 'aria-label': 'Move Steps' }, 'grip') })).toContain('aria-label="Move Steps"');
  });

  it('an unreadable card keeps the shell and shows its problem instead of a body', () => {
    const html = renderToStaticMarkup(
      createElement(CardShell, {
        title: 'This card can’t be shown',
        actions: [action('remove', 'Remove', true)],
        problem: 'This card was saved by a newer version of Vital.',
      })
    );
    expect(html).toContain('This card was saved by a newer version of Vital.');
    expect(html).toContain('Options for This card can’t be shown');
    expect(html).toContain('<article');
  });

  it('marks the card for focus handling', () => {
    expect(render({ cardId: 'card-1' })).toContain('data-card-id="card-1"');
  });
});
