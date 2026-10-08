// ── Dashboard page state (pure reducer) ─────────────────────────────────────
//
// docs/design/dashboard.md §8.2. Card values never load: they resolve from the
// dataset already installed, so the only thing that loads is the list of cards.
// Add, edit and remove are here; reorder arrives with its controls.

import { DashboardRequestError } from '@/lib/dashboard/client';
import type { CardRecord } from '@/lib/dashboard/types';

export interface DashboardError {
  message: string;
  /** The route's HTTP status, or null when the request never got an answer. */
  httpStatus: number | null;
}

export interface DashboardState {
  status: 'loading' | 'error' | 'ready';
  cards: CardRecord[];
  error: DashboardError | null;
  /** A plain sentence about a change that did not go through. */
  notice: string | null;
}

export type DashboardAction =
  | { type: 'loaded'; cards: CardRecord[] }
  | { type: 'failed'; message: string; httpStatus: number | null }
  | { type: 'reload' }
  | { type: 'added'; card: CardRecord }
  | { type: 'edited'; card: CardRecord }
  | { type: 'removed'; id: string }
  | { type: 'write-failed'; message: string }
  | { type: 'dismiss-notice' };

export const initialDashboardState: DashboardState = {
  status: 'loading',
  cards: [],
  error: null,
  notice: null,
};

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'loaded':
      return { ...state, status: 'ready', cards: action.cards, error: null };
    case 'failed':
      return {
        ...state,
        status: 'error',
        cards: [],
        error: { message: action.message, httpStatus: action.httpStatus },
      };
    case 'reload':
      // Cards already on screen stay while the next answer arrives.
      return state.status === 'ready' ? state : { ...state, status: 'loading', cards: [], error: null };
    case 'added':
      return { ...state, cards: [...state.cards, action.card] };
    case 'edited':
      return { ...state, cards: state.cards.map(c => (c.id === action.card.id ? action.card : c)) };
    case 'removed':
      return { ...state, cards: state.cards.filter(c => c.id !== action.id) };
    case 'write-failed':
      return { ...state, notice: action.message };
    case 'dismiss-notice':
      return { ...state, notice: null };
  }
}

export type WriteKind = 'add' | 'edit' | 'remove';

const FAILED: Record<WriteKind, string> = {
  add: 'The card was not added',
  edit: 'The card was not saved',
  remove: 'The card was not removed',
};

/** The sentence for a write that did not go through (the maps pattern: say so, then reload). */
export function writeFailureNotice(kind: WriteKind, error: unknown): string {
  if (error instanceof DashboardRequestError && error.status === 409) {
    return `This card was changed elsewhere; the dashboard was reloaded and nothing was ${
      kind === 'remove' ? 'removed' : 'overwritten'
    }.`;
  }
  return error instanceof Error ? `${FAILED[kind]}: ${error.message}` : `${FAILED[kind]}.`;
}

export type FocusTarget = { kind: 'card'; id: string } | { kind: 'add' };

/** After a remove: the next card's options button, else the previous one's, else Add card. */
export function focusAfterRemove(ids: readonly string[], removedId: string): FocusTarget {
  const at = ids.indexOf(removedId);
  const neighbour = at < 0 ? undefined : (ids[at + 1] ?? ids[at - 1]);
  return neighbour ? { kind: 'card', id: neighbour } : { kind: 'add' };
}

/** What a dialog hears back from an add or an edit. */
export type WriteResult =
  | { ok: true; card: CardRecord }
  | {
      ok: false;
      message: string;
      /** The card as it is now, when a save met a newer revision. */
      current?: CardRecord;
      /** True when the person can fix it in the dialog (400, 409); false when the page already reported it. */
      keepOpen: boolean;
    };

/** Sorts a failed add or edit: fix it in the dialog (400, 409), or report it on the page and reload. */
export function failedWrite(kind: 'add' | 'edit', error: unknown): Extract<WriteResult, { ok: false }> {
  if (error instanceof DashboardRequestError) {
    if (error.status === 400 || (kind === 'add' && error.status === 409)) {
      return { ok: false, message: error.message, keepOpen: true };
    }
    if (kind === 'edit' && error.status === 409 && error.current) {
      return { ok: false, message: error.message, current: error.current, keepOpen: true };
    }
  }
  return { ok: false, message: writeFailureNotice(kind, error), keepOpen: false };
}
