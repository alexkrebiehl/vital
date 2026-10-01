// ── Progression-model contract ──────────────────────────
//
// A progression model turns a stage's performance records into the same small
// evaluation, whatever the discipline: table rows, a light, how close the path
// is to its next stage, and a default next action. The shared pipeline
// (progress.ts) then applies what every model shares — holds, recovery gates,
// deload blocks — so a model only has to judge performance. Deload sessions
// (`eased`) keep their table row but are left out of the judgement.

import type { UnitSystem } from '../../prefs';
import { easedKey, type DeloadWindow } from '../deload';
import type { PerformanceRecord } from '../records';
import type { Block, Dose, Path, PlanRules, Range, Stage } from '../types';

/** One shared scale for every model. `none` means nothing has been logged. */
export type Light = 'green' | 'yellow-green' | 'yellow' | 'red' | 'none';

export const LIGHT_ORDER: Light[] = ['none', 'red', 'yellow', 'yellow-green', 'green'];

export interface ProgressRow {
  /** Local days merged into this row (identical work on several days). */
  dates: string[];
  sessionIds: string[];
  stageId: string;
  /** "Decline push-up 12/12/10", "Bench 3×5 @ 85 kg", "Week of Sep 7: 24.3 km". */
  work: string;
  /** The model's headline number: "34 reps", "e1RM 96 kg", "4 runs". */
  headline: string;
  /** "RPE 8.5–9.5", or null when no effort was logged. */
  effort: string | null;
  signal: string;
  notes?: string;
  /** Work on other stages of the path from the same day(s), shown in the same row. */
  also?: ProgressRow[];
}

export interface Readiness {
  /** Qualifying sessions (or weeks) so far in this stage. */
  qualifying: number;
  needed: number;
  met: boolean;
  /**
   * 0–1 toward the next stage: mostly how close the best recent session came to
   * the marker, then effort inside the ceiling, then repeating it for `needed`.
   */
  progress: number;
  /** "2 of 3 qualifying sessions". */
  label: string;
  unit: 'sessions' | 'weeks';
}

export interface ModelEvaluation {
  rows: ProgressRow[];
  light: Light;
  /** Plain reasons behind the light, most important first. */
  reasons: string[];
  readiness: Readiness | null;
  nextAction: string;
  /** The dose the evaluation measured against. */
  target: Dose | undefined;
  /** Numbers the narrative may quote (so the grounding guard can check them). */
  facts: Record<string, string | number>;
}

export interface EvaluationContext {
  path: Path;
  stage: Stage;
  nextStage: Stage | null;
  /** Records for the current stage since it began, oldest first. */
  records: PerformanceRecord[];
  /** Records of the previous stage (for context rows). */
  previousRecords: PerformanceRecord[];
  previousStage: Stage | null;
  rules: PlanRules;
  /** Blocks running this week. */
  blocks: Block[];
  /** Deload sessions of this path (`stageId:sessionId`, see deload.ts): shown, never judged. */
  eased: Set<string>;
  /** The deload running today, if any. */
  deloadWindow: DeloadWindow | null;
  today: string;
  system: UnitSystem;
}

export interface ProgressionModel {
  id: string;
  evaluate(ctx: EvaluationContext): ModelEvaluation;
}

/** The signal on a deload session's row. */
export const DELOAD_SIGNAL = 'Deload session · progress paused';

/** Whether a record of the stage being judged is a deload session. */
export function easedIn(ctx: EvaluationContext): (record: PerformanceRecord) => boolean {
  return record => ctx.eased.has(easedKey(ctx.stage.id, record.sessionId));
}

/** The effort ceiling a dose (or the plan's rules) allows, as an RPE. */
export function rpeCeiling(dose: Dose | undefined, rules: PlanRules): number | null {
  const rpe = dose?.effort?.rpe ?? rules.effort?.rpe;
  const rir = dose?.effort?.rir ?? rules.effort?.rir;
  const fromRpe = rpe ? rpe[1] : null;
  const fromRir = rir ? 10 - rir[0] : null;
  if (fromRpe === null) return fromRir;
  if (fromRir === null) return fromRpe;
  return Math.min(fromRpe, fromRir);
}

export function qualifyingRange(stage: Stage, rules: PlanRules): Range {
  return stage.qualifyingSessions ?? rules.qualifyingSessions;
}
