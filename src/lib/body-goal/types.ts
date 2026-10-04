// ── Body goal: shared types and the validator ───────────
//
// The goal the Body and Nutrition pages are read against: a target body weight
// or a target body-fat percentage, and optionally the pace the reader wants to
// move at. Cutting, bulking and maintaining all come out of the same goal —
// which one it is depends on where the data says the reader is now, so the goal
// never has to be re-entered when they cross it.
//
// CONFIGURATION ONLY (db/migrations/0010): a target, a pace and the day it was
// set. Where the reader started is read from the health data on `startedOn`
// every time, and is never stored.
//
// This module has NO imports, so the browser, the API route and the store share
// one validator.

export type BodyGoalKind = 'weight' | 'body_fat';

export interface BodyGoal {
  id: string;
  kind: BodyGoalKind;
  /** kg for a weight goal, percent for a body-fat goal. */
  target: number;
  /** The reader's own pace in kg/week, negative when losing. Null follows the recommendation. */
  paceKgPerWeek: number | null;
  /** Calendar day (`YYYY-MM-DD`) the goal was set. */
  startedOn: string;
  /** Calendar day the goal was replaced or ended, or null while active. */
  endedOn: string | null;
  status: 'active' | 'archived';
  revision: number;
  updatedAt: string;
}

/** What a PUT may set. */
export interface BodyGoalInput {
  kind: BodyGoalKind;
  target: number;
  paceKgPerWeek: number | null;
}

export interface BodyGoalsState {
  active: BodyGoal | null;
  /** Earlier goals, newest first. */
  history: BodyGoal[];
}

export const BODY_GOAL_FIELDS = ['kind', 'target', 'paceKgPerWeek'] as const;

/** Plausible targets. Anything outside is a typo or a unit mix-up, not a goal. */
export const TARGET_BOUNDS: Record<BodyGoalKind, { min: number; max: number }> = {
  weight: { min: 30, max: 300 },
  body_fat: { min: 3, max: 60 },
};

/** The largest pace the reader may set, either way. ~2 kg/week is already past every guideline. */
export const MAX_PACE_KG_PER_WEEK = 2;

export type BodyGoalValidation = { ok: true; input: BodyGoalInput } | { ok: false; errors: string[] };

export function validateBodyGoalInput(raw: unknown): BodyGoalValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The request body must be a JSON object.'] };
  }
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const unknown = Object.keys(body).filter(k => !(BODY_GOAL_FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    errors.push(`Unknown field(s): ${unknown.join(', ')}. Allowed fields are ${BODY_GOAL_FIELDS.join(', ')}.`);
  }

  const kind = body.kind;
  if (kind !== 'weight' && kind !== 'body_fat') {
    errors.push('"kind" must be "weight" or "body_fat".');
  }

  const target = body.target;
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    errors.push('"target" must be a number.');
  } else if (kind === 'weight' || kind === 'body_fat') {
    const { min, max } = TARGET_BOUNDS[kind];
    if (target < min || target > max) {
      errors.push(
        kind === 'weight'
          ? `"target" must be between ${min} and ${max} kg.`
          : `"target" must be between ${min} and ${max} percent.`
      );
    }
  }

  const pace = body.paceKgPerWeek;
  if (pace !== undefined && pace !== null) {
    if (typeof pace !== 'number' || !Number.isFinite(pace)) {
      errors.push('"paceKgPerWeek" must be a number or null.');
    } else if (Math.abs(pace) > MAX_PACE_KG_PER_WEEK) {
      errors.push(`"paceKgPerWeek" must be within ±${MAX_PACE_KG_PER_WEEK} kg per week.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      kind: kind as BodyGoalKind,
      target: target as number,
      paceKgPerWeek: typeof pace === 'number' ? pace : null,
    },
  };
}
