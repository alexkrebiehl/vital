// ── Dashboard cards: shared types and limits (server and client, no React) ───
//
// See docs/design/dashboard.md §3.1. A card holds ids, a spec (a metric id and
// day keys), a layout and timestamps. It never holds a health value.

export type DashboardMode = 'demo' | 'live'; // = DataMode from adapters/dataset

/** Inclusive calendar day keys, YYYY-MM-DD, in the dataset's own day convention. */
export type DateSpec =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'range'; start: string; end: string };

/** Grid units, 1..4 each. */
export interface CardSize {
  w: number;
  h: number;
}
export interface CardLayout extends CardSize {
  order: number;
}

export interface ValueCardSpec {
  metricId: string;
  date: DateSpec;
}

export interface CardRecord<S = unknown> {
  id: string; // 'card-<uuid>'
  type: string; // 'value' in phase 1
  spec: S | null; // null only when status is 'unreadable'
  schemaVersion: number; // version of `spec` for its type
  layout: CardLayout;
  revision: number; // per card, for edit/delete concurrency
  createdAt: string;
  updatedAt: string;
  status: 'ok' | 'unreadable';
  problem?: string; // plain-words reason when unreadable
}

export const MAX_CARDS_PER_MODE = 48;
export const MAX_SPEC_BYTES = 2048;
