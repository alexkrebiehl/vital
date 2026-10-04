// ── Body goal: composition and the goal weight ──────────
//
// A body-fat target becomes a goal WEIGHT only once you assume how much of the
// change will be lean mass. Losing nothing but fat is the ideal; in practice a
// share of a cut is lean mass (more of it at faster paces), and a share of a
// bulk is fat. So the goal weight is shown under a few assumptions, including
// the share the reader's own data shows so far, rather than as one number.
//
// With W₀ weight, F₀ fat mass, t the target fraction and s the share of the
// change that is lean, the change Δ that lands on t solves
//     (F₀ + (1 − s)·Δ) / (W₀ + Δ) = t   ⇒   Δ = (t·W₀ − F₀) / ((1 − s) − t)
// which covers cutting (Δ < 0) and gaining (Δ > 0) alike.
//
// Scale body-fat readings (bioimpedance) can be off by 3–5 points; the pages
// say so and suggest judging by the trend and a waist measurement.

import { AT_GOAL_BODY_FAT_POINTS, AT_GOAL_WEIGHT_SHARE, IDEAL_LEAN_SHARE, LOW_BODY_FAT, MIN_CHANGE_FOR_SHARE_KG, REALISTIC_LEAN_SHARE } from './constants';
import type { GoalPhase } from './phase';
import type { BodyGoal } from './types';
import { currentReading, readingNear, type DayValue, type Reading } from './trend';

export interface CompositionNow {
  bodyFat: Reading | null;
  leanKg: number | null;
  fatKg: number | null;
  leanSource: 'lean_body_mass' | 'derived' | null;
}

export function compositionNow(series: (id: string) => DayValue[], today: string, weight: Reading | null): CompositionNow {
  const bodyFat = currentReading(series('body_fat_percentage'), today);
  const lean = currentReading(series('lean_body_mass'), today);
  if (weight && bodyFat) {
    const fatKg = (weight.value * bodyFat.value) / 100;
    return { bodyFat, leanKg: weight.value - fatKg, fatKg, leanSource: 'derived' };
  }
  if (weight && lean) {
    // Body fat follows from lean mass when only lean mass is recorded.
    const fatKg = weight.value - lean.value;
    const derived = { ...lean, value: (fatKg / weight.value) * 100 };
    return { bodyFat: derived, leanKg: lean.value, fatKg, leanSource: 'lean_body_mass' };
  }
  return { bodyFat, leanKg: null, fatKg: null, leanSource: null };
}

export interface LeanShare {
  /** Share of the weight change that was lean mass (0.25 = a quarter). */
  share: number;
  weightChangeKg: number;
  leanChangeKg: number;
  from: string;
  to: string;
}

/**
 * The share of the change since `startedOn` that was lean mass, from body-fat
 * readings at both ends. Null when either end has no reading, or the weight has
 * changed too little for the ratio to mean anything.
 */
export function observedLeanShare(
  series: (id: string) => DayValue[],
  startedOn: string,
  today: string
): LeanShare | null {
  const w0 = readingNear(series('weight_body_mass'), startedOn);
  const bf0 = readingNear(series('body_fat_percentage'), startedOn);
  const w1 = currentReading(series('weight_body_mass'), today);
  const bf1 = currentReading(series('body_fat_percentage'), today);
  if (!w0 || !bf0 || !w1 || !bf1) return null;
  const dW = w1.value - w0.value;
  if (Math.abs(dW) < MIN_CHANGE_FOR_SHARE_KG) return null;
  const lean0 = w0.value * (1 - bf0.value / 100);
  const lean1 = w1.value * (1 - bf1.value / 100);
  const dLean = lean1 - lean0;
  return { share: dLean / dW, weightChangeKg: dW, leanChangeKg: dLean, from: w0.from, to: w1.to };
}

export interface GoalWeightScenario {
  id: 'ideal' | 'realistic' | 'observed';
  label: string;
  leanShare: number;
  goalWeightKg: number;
  changeKg: number;
}

/** The change in weight that lands on `targetPct` body fat, assuming `leanShare` of it is lean. */
export function changeToTarget(weightKg: number, fatKg: number, targetPct: number, leanShare: number): number | null {
  const t = targetPct / 100;
  const denominator = 1 - leanShare - t;
  if (denominator <= 0.01) return null;
  return (t * weightKg - fatKg) / denominator;
}

export function goalWeightScenarios(input: {
  phase: GoalPhase;
  weightKg: number;
  fatKg: number;
  targetPct: number;
  observed: LeanShare | null;
}): GoalWeightScenario[] {
  const { phase, weightKg, fatKg, targetPct, observed } = input;
  if (phase === 'maintain') return [];
  const out: GoalWeightScenario[] = [];
  const add = (id: GoalWeightScenario['id'], label: string, share: number) => {
    const change = changeToTarget(weightKg, fatKg, targetPct, share);
    if (change === null) return;
    out.push({ id, label, leanShare: share, goalWeightKg: weightKg + change, changeKg: change });
  };
  if (phase === 'cut') {
    add('ideal', 'Only fat is lost', IDEAL_LEAN_SHARE.cut);
    add('realistic', `About ${Math.round(REALISTIC_LEAN_SHARE.cut * 100)} % of the loss is lean (typical at a moderate pace)`, REALISTIC_LEAN_SHARE.cut);
  } else {
    add('ideal', `About ${Math.round(IDEAL_LEAN_SHARE.bulk * 100)} % of the gain is lean (a slow, well-trained gain)`, IDEAL_LEAN_SHARE.bulk);
    add('realistic', `About ${Math.round(REALISTIC_LEAN_SHARE.bulk * 100)} % of the gain is lean (typical)`, REALISTIC_LEAN_SHARE.bulk);
  }
  if (observed) {
    const share = Math.min(1, Math.max(0, observed.share));
    add('observed', `About ${Math.round(share * 100)} % lean (your trend since the goal started)`, share);
  }
  return out;
}

/** Body fat at `targetWeightKg`, assuming `leanShare` of the change is lean. */
export function projectedBodyFat(weightKg: number, fatKg: number, targetWeightKg: number, leanShare: number): number {
  const change = targetWeightKg - weightKg;
  return ((fatKg + (1 - leanShare) * change) / targetWeightKg) * 100;
}

export function realisticShare(phase: GoalPhase): number {
  return phase === 'bulk' ? REALISTIC_LEAN_SHARE.bulk : REALISTIC_LEAN_SHARE.cut;
}

/** The weights that count as holding the goal, once it is reached. */
export interface MaintenanceRange {
  centerKg: number;
  lowKg: number;
  highKg: number;
  /** How the range was formed, in one sentence. */
  basis: string;
}

/**
 * The weight band the goal is held in: the same tolerance that puts the goal
 * in maintenance, in kg. For a weight goal, the target ± 1 % of current
 * weight. For a body-fat goal, the weights at the target ± 0.5 points with
 * today's lean mass held — null without a lean-mass figure.
 */
export function maintenanceRange(
  goal: Pick<BodyGoal, 'kind' | 'target'>,
  weightKg: number,
  leanKg: number | null
): MaintenanceRange | null {
  if (goal.kind === 'weight') {
    const half = weightKg * AT_GOAL_WEIGHT_SHARE;
    return {
      centerKg: goal.target,
      lowKg: goal.target - half,
      highKg: goal.target + half,
      basis: `Within ${AT_GOAL_WEIGHT_SHARE * 100} % of body weight of the target.`,
    };
  }
  if (leanKg === null) return null;
  const at = (pct: number) => leanKg / (1 - pct / 100);
  return {
    centerKg: at(goal.target),
    lowKg: at(goal.target - AT_GOAL_BODY_FAT_POINTS),
    highKg: at(goal.target + AT_GOAL_BODY_FAT_POINTS),
    basis: `The weights at ${goal.target - AT_GOAL_BODY_FAT_POINTS}–${goal.target + AT_GOAL_BODY_FAT_POINTS} % body fat, with today's lean mass.`,
  };
}

export interface LowBodyFatNote {
  /** essential: at or below the body's minimum; very-lean: contest-level. */
  level: 'essential' | 'very-lean';
  text: string;
}

/**
 * A word of caution for a body-fat target (or the body fat a weight target
 * lands at) that is very low for the reader's sex. Advice only: the target is
 * still the reader's to set. Without sex set, no sex is assumed — the note
 * names both and suggests setting it.
 */
export function lowBodyFatNote(pct: number, sex: 'male' | 'female' | null): LowBodyFatNote | null {
  const p = `${Number(pct.toFixed(1))} %`;
  const { male, female } = LOW_BODY_FAT;
  const cost = 'hard to hold, and it tends to cost energy, hormones, sleep and recovery';
  if (sex !== null) {
    const t = LOW_BODY_FAT[sex];
    const who = sex === 'male' ? 'men' : 'women';
    const essential = sex === 'male' ? '2–5 %' : '10–13 %';
    if (pct <= t.essential) {
      return { level: 'essential', text: `${p} is at the essential fat ${who} need (about ${essential}) — not a level to diet to.` };
    }
    if (pct < t.veryLean) return { level: 'very-lean', text: `${p} is contest-level for ${who}: ${cost}.` };
    return null;
  }
  if (pct <= male.essential) {
    return { level: 'essential', text: `${p} is at or below essential fat for anyone (about 2–5 % for men, 10–13 % for women) — not a level to diet to.` };
  }
  if (pct < male.veryLean) {
    return { level: 'essential', text: `${p} is contest-level for men and below essential fat for women (about 10–13 %). Set your sex in Settings for a note that fits you.` };
  }
  if (pct <= female.essential) {
    return { level: 'essential', text: `${p} is at or below essential fat for women (about 10–13 %), though lean but ordinary for men. Set your sex in Settings for a note that fits you.` };
  }
  if (pct < female.veryLean) {
    return { level: 'very-lean', text: `${p} is contest-level for women (${cost}), though ordinary for men. Set your sex in Settings for a note that fits you.` };
  }
  return null;
}
