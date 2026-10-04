'use client';

// ── Body goal in the browser ────────────────────────────
//
// `useBodyGoal` reads and writes the goal through /api/body-goal.
// `useBodyGoalReport` turns it into the engine's report over the active
// dataset, in the reader's units. A failure is shown as the route's own message;
// nothing is invented in its place.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { useProfile } from '@/components/profile/ProfileProvider';
import { useUnits } from '@/components/ui/UnitsProvider';
import { inputsFromDataset } from '@/lib/body-goal/dataset';
import { bodyGoalReport, type BodyGoalReport } from '@/lib/body-goal/report';
import type { BodyGoal, BodyGoalInput, BodyGoalsState } from '@/lib/body-goal/types';

export type GoalLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: BodyGoalsState };

/** Tell every mounted reader that the goal changed (the Overview tile and the Body page can both be open). */
const CHANGED = 'vital:body-goal-changed';

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${fallback} (HTTP ${res.status}).`;
}

export function useBodyGoal() {
  const [state, setState] = useState<GoalLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/body-goal', { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(await errorOf(res, 'The goal could not be loaded'));
        return (await res.json()) as BodyGoalsState;
      })
      .then(data => !cancelled && setState({ status: 'ok', data }))
      .catch(e => !cancelled && setState({ status: 'error', message: e instanceof Error ? e.message : 'The goal could not be loaded.' }));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    const onChange = () => setNonce(n => n + 1);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);

  const active = state.status === 'ok' ? state.data.active : null;

  /** Save `input`: a new goal when `startNew` (or none is active), otherwise an edit of the active one. */
  const save = useCallback(
    async (input: BodyGoalInput, startNew: boolean): Promise<BodyGoal> => {
      const res = await fetch('/api/body-goal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: input, revision: active?.revision ?? null, startNew }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'The goal could not be saved'));
      const saved = (await res.json()) as BodyGoal;
      window.dispatchEvent(new Event(CHANGED));
      return saved;
    },
    [active]
  );

  const end = useCallback(async (): Promise<void> => {
    if (!active) return;
    const res = await fetch(`/api/body-goal?revision=${active.revision}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await errorOf(res, 'The goal could not be ended'));
    window.dispatchEvent(new Event(CHANGED));
  }, [active]);

  return { state, active, save, end, reload: () => setNonce(n => n + 1) };
}

/** The engine's report for a goal over the active dataset, in the reader's units. */
export function useGoalReport(goal: BodyGoal | null): BodyGoalReport | null {
  const { units } = useUnits();
  const { profile } = useProfile();
  const meta = useDatasetMeta();
  return useMemo(
    () => (goal ? bodyGoalReport(goal, inputsFromDataset(units, profile.sex)) : null),
    // The dataset is module state; its identity changes with the meta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goal, units, profile.sex, meta.generatedAt, meta.referenceKey, meta.mode]
  );
}
