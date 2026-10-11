// ── Body goal on the server (SERVER ONLY) ───────────────
//
// The read the briefing and the analyst make. The `read*` functions treat a goal
// that cannot be read (no database, a database error) as "no goal": the briefing
// still answers, just without it, the same way a missing profile is handled. The
// `load*` functions say so instead (they throw), for a reader that must not tell
// "no goal is set" from "the goal could not be read" (the analyst's tools).

import { readBodyGoals } from '@/lib/db/body-goal-store';
import { readProfile } from '@/lib/profile/store';
import type { UnitSystem } from '../prefs';
import { goalReportFromDataset, goalSummaryFromDataset } from './dataset';
import type { BodyGoalReport } from './report';
import type { BodyGoalSummary } from './summary';
import type { BodyGoal } from './types';

/** The active goal, or null when none is set. Throws when the goals cannot be read. */
export async function loadActiveBodyGoal(env: NodeJS.ProcessEnv = process.env): Promise<BodyGoal | null> {
  return (await readBodyGoals(env)).active;
}

export async function readActiveBodyGoal(env: NodeJS.ProcessEnv = process.env): Promise<BodyGoal | null> {
  try {
    return await loadActiveBodyGoal(env);
  } catch {
    return null;
  }
}

const sexOf = (env: NodeJS.ProcessEnv) => readProfile(env).then(p => p.sex).catch(() => null);

/** The active goal's model-facing summary over the active dataset, null with no goal; throws when the goal cannot be read. */
export async function loadGoalSummary(system: UnitSystem, env: NodeJS.ProcessEnv = process.env): Promise<BodyGoalSummary | null> {
  const goal = await loadActiveBodyGoal(env);
  return goal ? goalSummaryFromDataset(goal, system, await sexOf(env)) : null;
}

/** The active goal's whole report over the active dataset, null with no goal; throws when the goal cannot be read. */
export async function loadGoalReport(system: UnitSystem, env: NodeJS.ProcessEnv = process.env): Promise<BodyGoalReport | null> {
  const goal = await loadActiveBodyGoal(env);
  return goal ? goalReportFromDataset(goal, system, await sexOf(env)) : null;
}

/** The active goal's model-facing summary over the active dataset, or null with no goal. */
export async function readGoalSummary(system: UnitSystem, env: NodeJS.ProcessEnv = process.env): Promise<BodyGoalSummary | null> {
  const goal = await readActiveBodyGoal(env);
  if (!goal) return null;
  return goalSummaryFromDataset(goal, system, await sexOf(env));
}
