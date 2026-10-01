'use client';

// ── Theme card ──────────────────────────────────────────
//
// One theme on the Themes page. The preview is drawn with the theme's OWN
// tokens: its wrapper carries `data-theme`, which re-scopes every `--color-*`
// variable (see globals.css), so a dark card shows real dark colours on a light
// page and the other way round. Nothing here repeats a hex value.
//
// Inside the preview only token classes are used, never Tailwind's `dark:`
// variants: those follow the page's `dark` class, not the card's theme.

import { Check } from 'lucide-react';
import { themeAttr, type ThemeDef } from '@/lib/prefs';

const SWATCHES: { label: string; className: string }[] = [
  { label: 'Page', className: 'bg-page' },
  { label: 'Surface', className: 'bg-surface' },
  { label: 'Accent', className: 'bg-accent' },
  { label: 'Hero', className: 'bg-hero' },
  { label: 'Activity', className: 'bg-category-activity' },
  { label: 'Cardiovascular', className: 'bg-category-cardiovascular' },
  { label: 'Sleep', className: 'bg-category-sleep' },
  { label: 'Body', className: 'bg-category-body' },
  { label: 'Nutrition', className: 'bg-category-nutrition' },
  { label: 'Attention', className: 'bg-category-attention' },
];

export function ThemeCard({
  theme,
  selected,
  inUse,
  onSelect,
}: {
  theme: ThemeDef;
  /** This side's pick. */
  selected: boolean;
  /** The theme the page is showing right now. */
  inUse: boolean;
  onSelect: () => void;
}) {
  const side = theme.scheme === 'dark' ? 'Dark' : 'Light';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${side} theme: ${theme.name}${inUse ? ' (in use)' : ''}`}
      className={`group w-full text-left rounded-card border bg-surface overflow-hidden transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:shadow-md'
      }`}
    >
      <div
        data-theme={themeAttr(theme.scheme, theme.id)}
        className={`${theme.scheme === 'dark' ? 'dark' : ''} bg-page text-text-primary p-3 space-y-3`}
        aria-hidden="true"
      >
        {/* A miniature page: a hero strip, a card with text and a button. */}
        <div className="rounded-control bg-hero border border-hero-border px-3 py-2 space-y-1.5">
          <div className="h-1.5 w-16 rounded-full bg-hero-muted" />
          <div className="h-2 w-28 rounded-full bg-hero-foreground" />
        </div>
        <div className="rounded-control bg-surface border border-border p-3 space-y-2">
          <div className="h-2 w-24 rounded-full bg-text-primary" />
          <div className="h-1.5 w-32 rounded-full bg-text-secondary" />
          <div className="h-1.5 w-20 rounded-full bg-text-secondary" />
          <div className="flex items-center gap-2 pt-1">
            <span className="h-5 w-14 rounded-full bg-primary" />
            <span className="h-5 w-10 rounded-full bg-accent-tint border border-border" />
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0">
          {SWATCHES.map(s => (
            <li key={s.label} title={s.label} className={`h-4 w-4 rounded-full border border-border ${s.className}`} />
          ))}
        </ul>
      </div>

      <div className="flex items-start justify-between gap-2 px-4 py-3 border-t border-border">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{theme.name}</p>
          {theme.description && <p className="text-xs text-text-secondary mt-0.5">{theme.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {inUse && (
            <span className="text-[11px] font-medium text-text-secondary rounded-full bg-surface-muted px-2 py-0.5">
              In use
            </span>
          )}
          {selected && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-text">
              <Check size={12} aria-hidden="true" />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
