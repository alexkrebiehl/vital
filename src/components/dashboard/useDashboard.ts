'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  DashboardRequestError,
  createCardRequest,
  deleteCardRequest,
  fetchDashboard,
  replaceCardRequest,
  type CardEditInput,
  type CardInput,
} from '@/lib/dashboard/client';
import type { CardRecord } from '@/lib/dashboard/types';
import {
  dashboardReducer,
  failedWrite,
  initialDashboardState,
  writeFailureNotice,
  type WriteResult,
} from './dashboard-state';

/** Loads the cards once, and again on `reload`. Card values are not loaded: they resolve from the dataset. */
export function useDashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchDashboard();
      if (alive.current) dispatch({ type: 'loaded', cards: res.cards });
    } catch (e) {
      if (!alive.current) return;
      dispatch({
        type: 'failed',
        message: e instanceof Error ? e.message : 'The dashboard could not be read.',
        httpStatus: e instanceof DashboardRequestError ? e.status : null,
      });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const reload = useCallback(() => {
    dispatch({ type: 'reload' });
    void load();
  }, [load]);

  /** A failure the dialog cannot fix: say so on the page and read the cards again (the maps pattern). */
  const report = useCallback(
    (failure: Extract<WriteResult, { ok: false }>) => {
      if (failure.current) dispatch({ type: 'edited', card: failure.current });
      if (!failure.keepOpen) {
        dispatch({ type: 'write-failed', message: failure.message });
        reload();
      }
      return failure;
    },
    [reload]
  );

  // Add and edit are confirmed by the server before the card changes on screen.
  const add = useCallback(
    async (input: CardInput): Promise<WriteResult> => {
      dispatch({ type: 'dismiss-notice' });
      try {
        const card = await createCardRequest(input);
        dispatch({ type: 'added', card });
        return { ok: true, card };
      } catch (e) {
        return report(failedWrite('add', e));
      }
    },
    [report]
  );

  const edit = useCallback(
    async (card: CardRecord, input: CardEditInput): Promise<WriteResult> => {
      dispatch({ type: 'dismiss-notice' });
      try {
        const saved = await replaceCardRequest(card.id, input, card.revision);
        dispatch({ type: 'edited', card: saved });
        return { ok: true, card: saved };
      } catch (e) {
        return report(failedWrite('edit', e));
      }
    },
    [report]
  );

  // Remove is optimistic: the card leaves at once, and comes back through the reload if the server refuses.
  const remove = useCallback(
    async (card: CardRecord): Promise<void> => {
      dispatch({ type: 'dismiss-notice' });
      dispatch({ type: 'removed', id: card.id });
      try {
        await deleteCardRequest(card.id, card.revision);
      } catch (e) {
        if (e instanceof DashboardRequestError && e.status === 404) return; // already gone: done
        dispatch({ type: 'write-failed', message: writeFailureNotice('remove', e) });
        reload();
      }
    },
    [reload]
  );

  return { state, dispatch, reload, add, edit, remove };
}
