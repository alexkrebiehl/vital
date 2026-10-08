'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { DashboardRequestError, fetchDashboard } from '@/lib/dashboard/client';
import { dashboardReducer, initialDashboardState } from './dashboard-state';

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

  return { state, dispatch, reload };
}
