import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gridSpanClasses } from './grid';

const ALLOWED = new Set([
  'col-span-1',
  ...[1, 2].map(n => `sm:col-span-${n}`),
  ...[1, 2, 3].map(n => `lg:col-span-${n}`),
  ...[1, 2, 3, 4].map(n => `xl:col-span-${n}`),
  ...[1, 2, 3, 4].map(n => `row-span-${n}`),
]);

describe('gridSpanClasses', () => {
  it('returns only known literal classes for every size 1..4', () => {
    for (const w of [1, 2, 3, 4]) {
      for (const h of [1, 2, 3, 4]) {
        for (const cls of gridSpanClasses({ w, h }).split(' ')) expect(ALLOWED.has(cls)).toBe(true);
      }
    }
  });

  it('caps the width at each breakpoint: 1, 2, 3 and 4 columns', () => {
    expect(gridSpanClasses({ w: 4, h: 1 }).split(' ')).toEqual([
      'col-span-1', 'sm:col-span-2', 'lg:col-span-3', 'xl:col-span-4', 'row-span-1',
    ]);
    expect(gridSpanClasses({ w: 3, h: 2 }).split(' ')).toEqual([
      'col-span-1', 'sm:col-span-2', 'lg:col-span-3', 'xl:col-span-3', 'row-span-2',
    ]);
    expect(gridSpanClasses({ w: 1, h: 1 }).split(' ')).toEqual([
      'col-span-1', 'sm:col-span-1', 'lg:col-span-1', 'xl:col-span-1', 'row-span-1',
    ]);
  });

  it('never spans more than one column on the one-column layout', () => {
    for (const w of [1, 2, 3, 4]) expect(gridSpanClasses({ w, h: 1 })).toMatch(/^col-span-1 /);
  });

  it('clamps a size outside 1..4 or fractional instead of building a class Tailwind never sees', () => {
    expect(gridSpanClasses({ w: 0, h: 9 })).toBe(gridSpanClasses({ w: 1, h: 4 }));
    expect(gridSpanClasses({ w: 2.6, h: -3 })).toBe(gridSpanClasses({ w: 3, h: 1 }));
    expect(gridSpanClasses({ w: NaN, h: NaN })).toBe(gridSpanClasses({ w: 1, h: 1 }));
  });

  it('writes every class out in full in the source, where Tailwind scans for it', () => {
    const source = readFileSync(new URL('./grid.ts', import.meta.url), 'utf8');
    for (const cls of ALLOWED) {
      if (cls === 'col-span-1') continue; // opens the returned template string
      expect(source).toContain(`'${cls}'`);
    }
    expect(source).toContain('`col-span-1 ');
  });
});
