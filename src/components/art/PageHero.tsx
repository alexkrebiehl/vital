import type { ReactNode } from 'react';
import { ContourField } from './ContourField';
import { CATEGORY_VAR, type ArtCategory } from './categories';

/**
 * The banner every page opens with: a tinted surface carrying generated
 * contour artwork in the page's category colour, an eyebrow, the title and a
 * one-line purpose, with an optional right-hand slot for a headline figure.
 */
export function PageHero({
  title, subtitle, eyebrow, category = 'neutral', seed, aside, children,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  category?: ArtCategory;
  seed?: number;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const color = CATEGORY_VAR[category];
  const s = seed ?? Array.from(title).reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <header
      className="relative isolate overflow-hidden rounded-[22px] border border-border bg-surface shadow-card"
      style={{ backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${color} 9%, var(--color-surface)) 0%, var(--color-surface) 62%)` }}
    >
      <ContourField category={category} seed={s} className="absolute inset-0 -z-10 h-full w-full opacity-90" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 px-6 py-7 md:px-9 md:py-9">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && (
            <p className="mb-3 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {eyebrow}
            </p>
          )}
          <h1 className="text-[32px] md:text-[44px] font-semibold leading-[1.04] tracking-[-0.04em] text-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-[14.5px] leading-relaxed text-text-secondary max-w-xl">{subtitle}</p>
          )}
          {children && <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </header>
  );
}
