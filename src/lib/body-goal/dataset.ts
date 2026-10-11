// ── Body goal: inputs from the active dataset ───────────
//
// The same series every page renders, so the engine reads what the reader sees.
// Safe in the browser and on the server.

import { REFERENCE_KEY, REFERENCE_TZ, seriesFor, workoutList } from '../adapters/dataset';
import { dayKey } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import { bodyGoalReport, type BodyGoalInputs, type BodyGoalReport } from './report';
import { bodyGoalSummary, type BodyGoalSummary } from './summary';
import type { BodyGoal } from './types';

export function inputsFromDataset(system: UnitSystem, sex: 'male' | 'female' | null): BodyGoalInputs {
  return {
    series: seriesFor,
    workoutDays: [...new Set(workoutList().map(w => dayKey(w.start_time, REFERENCE_TZ)))].sort(),
    today: REFERENCE_KEY,
    sex,
    system,
  };
}

/** The whole report of a goal over the active dataset (what the Body and Nutrition pages render). */
export function goalReportFromDataset(goal: BodyGoal, system: UnitSystem, sex: 'male' | 'female' | null): BodyGoalReport {
  return bodyGoalReport(goal, inputsFromDataset(system, sex));
}

/** The model-facing summary of a goal over the active dataset. */
export function goalSummaryFromDataset(goal: BodyGoal, system: UnitSystem, sex: 'male' | 'female' | null): BodyGoalSummary {
  return bodyGoalSummary(goalReportFromDataset(goal, system, sex), system);
}
