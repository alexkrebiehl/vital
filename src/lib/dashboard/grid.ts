// ── Dashboard grid: the classes a card spans (pure, no React) ───────────────
//
// docs/design/dashboard.md §8.3. The grid has 1 column under 640 px, 2 from
// `sm`, 3 from `lg` and 4 from `xl`, and a card spans min(w, columns). Tailwind
// finds classes by scanning source text, so every class below is written out in
// full: a class built from a template string would never be generated.

import type { CardSize } from './types';

const SM = ['sm:col-span-1', 'sm:col-span-2', 'sm:col-span-2', 'sm:col-span-2'] as const;
const LG = ['lg:col-span-1', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-3'] as const;
const XL = ['xl:col-span-1', 'xl:col-span-2', 'xl:col-span-3', 'xl:col-span-4'] as const;
const ROW = ['row-span-1', 'row-span-2', 'row-span-3', 'row-span-4'] as const;

/** A whole number from 1 to 4; anything else is pulled to the nearest. */
function unit(n: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(n)) return 0;
  return (Math.min(4, Math.max(1, Math.round(n))) - 1) as 0 | 1 | 2 | 3;
}

/** Span classes for a card of `size` grid units. One column on the smallest screens. */
export function gridSpanClasses(size: CardSize): string {
  const w = unit(size.w);
  const h = unit(size.h);
  return `col-span-1 ${SM[w]} ${LG[w]} ${XL[w]} ${ROW[h]}`;
}
