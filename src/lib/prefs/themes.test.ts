// Every theme in the catalogue must have a palette in globals.css, and every
// palette must set every colour token: a missing token would silently show
// another theme's colour through inheritance.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES, themeAttr } from './themes';

const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

/** The declarations of the block whose selector list names `attr`. */
function blockFor(attr: string): string | null {
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1].includes(`[data-theme="${attr}"]`)) return m[2];
  }
  return null;
}

const tokensOf = (block: string) => new Set([...block.matchAll(/--color-([a-z-]+):/g)].map(m => m[1]));

describe('theme catalogue ↔ globals.css', () => {
  const reference = tokensOf(blockFor('light-default') ?? '');

  it('the Default palette sets the colour tokens', () => {
    expect(reference.size).toBeGreaterThan(10);
  });

  it.each(THEMES.map(t => [themeAttr(t.scheme, t.id)]))('%s has a complete palette', attr => {
    const block = blockFor(attr);
    expect(block, `no [data-theme="${attr}"] block`).not.toBeNull();
    const tokens = tokensOf(block!);
    expect([...reference].filter(t => !tokens.has(t))).toEqual([]);
  });

  it('ids are unique on each side', () => {
    const keys = THEMES.map(t => themeAttr(t.scheme, t.id));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
