// ── Body goal: cut, bulk or maintain ────────────────────
//
// The phase is never entered: it is where the data puts the reader relative to
// the target. A weight target below the current trend weight is a cut, above it
// a bulk, and within a small tolerance of it the goal is reached and the
// guidance turns to maintenance. A body-fat target works the same way against
// the current body-fat reading.

import { AT_GOAL_BODY_FAT_POINTS, AT_GOAL_WEIGHT_SHARE } from './constants';
import type { BodyGoal } from './types';
import type { Reading } from './trend';

export type GoalPhase = 'cut' | 'bulk' | 'maintain';

export interface PhaseResult {
  phase: GoalPhase | null;
  /** The current value in the goal's own unit (kg or %), or null. */
  current: number | null;
  /** target − current, in the goal's unit. */
  remaining: number | null;
  /** Why the phase is unknown, when it is. */
  reason: string | null;
}

export function goalPhase(
  goal: Pick<BodyGoal, 'kind' | 'target'>,
  weight: Reading | null,
  bodyFat: Reading | null
): PhaseResult {
  if (goal.kind === 'weight') {
    if (!weight) return { phase: null, current: null, remaining: null, reason: 'There is no recent weigh-in to compare the target with.' };
    const remaining = goal.target - weight.value;
    const tolerance = weight.value * AT_GOAL_WEIGHT_SHARE;
    return {
      phase: Math.abs(remaining) <= tolerance ? 'maintain' : remaining < 0 ? 'cut' : 'bulk',
      current: weight.value,
      remaining,
      reason: null,
    };
  }
  if (!bodyFat) return { phase: null, current: null, remaining: null, reason: 'There is no recent body-fat reading to compare the target with.' };
  const remaining = goal.target - bodyFat.value;
  return {
    phase: Math.abs(remaining) <= AT_GOAL_BODY_FAT_POINTS ? 'maintain' : remaining < 0 ? 'cut' : 'bulk',
    current: bodyFat.value,
    remaining,
    reason: null,
  };
}

export const PHASE_LABEL: Record<GoalPhase, string> = {
  cut: 'Cutting',
  bulk: 'Gaining',
  maintain: 'Maintaining',
};
