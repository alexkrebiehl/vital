// ── Settings calls the tile providers "Map sources" (the Maps page keeps its name) ──

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapProvidersCard } from './MapProviders';

function render(): string {
  const heading = (icon: React.ReactNode, title: string) => createElement('h2', null, icon, title);
  return renderToStaticMarkup(createElement(MapProvidersCard, { heading }));
}

describe('Map sources card', () => {
  it('is headed "Map sources", not "Maps"', () => {
    const html = render();
    expect(html).toContain('>Map sources</h2>');
    expect(html).not.toMatch(/<\/svg>Maps<\/h2>/);
  });

  it('introduces the map sources and still points at the Activity → Maps page by its name', () => {
    const html = render();
    expect(html).toContain('The map sources Activity → Maps can draw on.');
  });
});
