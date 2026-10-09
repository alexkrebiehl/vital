import type { ComponentType } from 'react';
import type { CardSize } from '@/lib/dashboard/types';
import type { UnitSystem } from '@/lib/prefs';

/** What a card type needs to turn its spec into view data. `referenceKey` is always `REFERENCE_KEY`. */
export interface ResolveContext {
  referenceKey: string;
  system: UnitSystem;
}

/** What the shell prints above a card's body. */
export interface CardHeading {
  title: string;
  /** Picks the shell's category colour; omitted when the type has no metric. */
  metricId?: string;
  dateLabel?: string;
}

/**
 * The browser half of a card type (docs/design/dashboard.md §4.1).
 */
export interface CardTypeUi<S, D> {
  type: string;
  /** Pure: spec + active dataset -> view data. */
  resolve(spec: S, ctx: ResolveContext): D;
  Card: ComponentType<{ spec: S; data: D; size: CardSize }>;
  /** The dialog body. `onChange(null)` while the choice is incomplete or invalid. */
  Editor: ComponentType<{ value: S | null; onChange(spec: S | null): void }>;
  /** Accessible name: "Steps, today". */
  describe(spec: S): string;
  heading(spec: S, data: D): CardHeading;
}
