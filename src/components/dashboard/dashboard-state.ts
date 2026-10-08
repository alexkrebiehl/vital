// ── Dashboard page state (pure reducer) ─────────────────────────────────────
//
// docs/design/dashboard.md §8.2. Card values never load: they resolve from the
// dataset already installed, so the only thing that loads is the list of cards.
// The write actions (add, edit, remove, reorder) arrive with the gates that
// build those controls.

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
  | { type: 'reload' };

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
  }
}
