// ── Body goal on the server (SERVER ONLY) ───────────────
//
// The read the briefing and the analyst make. A goal that cannot be read (no
// database, a database error) is treated as "no goal": both surfaces still
// answer, just without it, the same way a missing profile is handled.

import { readBodyGoals } from '@/lib/db/body-goal-store';
import { readProfile } from '@/lib/profile/store';
import type { UnitSystem } from '../prefs';
import { goalSummaryFromDataset } from './dataset';
import type { BodyGoalSummary } from './summary';
import type { BodyGoal } from './types';

export async function readActiveBodyGoal(env: NodeJS.ProcessEnv = process.env): Promise<BodyGoal | null> {
  try {
    return (await readBodyGoals(env)).active;
  } catch {
    return null;
  }
}

/** The active goal's model-facing summary over the active dataset, or null with no goal. */
export async function readGoalSummary(system: UnitSystem, env: NodeJS.ProcessEnv = process.env): Promise<BodyGoalSummary | null> {
  const goal = await readActiveBodyGoal(env);
  if (!goal) return null;
  const sex = await readProfile(env).then(p => p.sex).catch(() => null);
  return goalSummaryFromDataset(goal, system, sex);
}
