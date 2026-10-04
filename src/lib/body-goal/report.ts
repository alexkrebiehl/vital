// ── Body goal: the whole picture in one report ──────────
//
// One pure function turns a goal and the health series into everything the
// Body and Nutrition pages, the Overview tile, the briefing and the analyst
// show, so no two surfaces can disagree about the numbers.
//
// The engine works in canonical units (kg, %, kcal, g); `system` only shapes
// the sentences it writes. It runs in the browser on the active dataset and on
// the server on the same dataset (see `inputsFromDataset`).

import { formatMetricWithUnit } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import {
  compositionNow,
  goalWeightScenarios,
  observedLeanShare,
  projectedBodyFat,
  realisticShare,
  type CompositionNow,
  type GoalWeightScenario,
  type LeanShare,
} from './composition';
import { macroConsistency, type MacroConsistency } from './consistency';
import {
  activeShareOfMaintenance,
  activityComparison,
  leanEffect,
  rateEffect,
  recoveryEffects,
  type ActivityComparison,
  type EffectItem,
} from './effects';
import { energyBalance, type EnergyBalance } from './energy';
import { adherence, monthlyIntake, type Adherence, type MonthIntake } from './intake';
import { effectivePace, recommendedBand, trendFit, type EffectivePace, type PaceBand, type TrendFit } from './pace';
import { goalPhase, type PhaseResult } from './phase';
import { projectArrival, type Projection } from './projection';
import { nutritionTargets, type NutritionTargets } from './targets';
import { readingNear, weightTrend, type DayValue, type Reading, type WeightTrend } from './trend';
import { addDays } from '../analytics/windows';
import { TREND_DAYS } from './constants';
import type { BodyGoal } from './types';
import type { RecoveryIndicator } from '../routine/recovery';

export interface BodyGoalInputs {
  /** Daily series in canonical units, oldest first. */
  series: (metricId: string) => DayValue[];
  /** Local days with a recorded workout. */
  workoutDays: string[];
  /** The data's current day. */
  today: string;
  sex: 'male' | 'female' | null;
  system: UnitSystem;
}

export interface BodyGoalReport {
  goal: BodyGoal;
  today: string;
  /** The day progress is measured from: the goal's start, or today when the data ends earlier. */
  anchor: string;
  weight: WeightTrend;
  composition: CompositionNow;
  phase: PhaseResult;
  start: { weight: Reading | null; bodyFat: Reading | null; value: number | null };
  /** 0–1 of the way from the start to the target, in the goal's unit. */
  progress: number | null;
  band: PaceBand | null;
  pace: EffectivePace | null;
  fit: TrendFit;
  energy: EnergyBalance;
  targets: NutritionTargets | null;
  /** The weight the goal lands at: the target itself, or the realistic scenario for a body-fat goal. */
  goalWeightKg: number | null;
  scenarios: GoalWeightScenario[];
  /** For a weight goal with body-fat data: body fat at the goal weight, realistic share. */
  bodyFatAtGoal: number | null;
  projection: Projection | null;
  leanShare: LeanShare | null;
  effects: {
    rate: EffectItem | null;
    lean: EffectItem | null;
    recovery: (RecoveryIndicator & { goalAdvice: string | null })[];
    activity: ActivityComparison;
    activeShare: number | null;
  };
  consistency: MacroConsistency;
  months: MonthIntake[];
  adherence: Adherence | null;
}

export function formatKg(kg: number, system: UnitSystem): string {
  return formatMetricWithUnit('weight_body_mass', kg, system);
}

export function formatSignedKg(kg: number, system: UnitSystem): string {
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '';
  return `${sign}${formatKg(Math.abs(kg), system)}`;
}

export function bodyGoalReport(goal: BodyGoal, inputs: BodyGoalInputs): BodyGoalReport {
  const { series, workoutDays, today, sex, system } = inputs;
  const anchor = goal.startedOn <= today ? goal.startedOn : today;
  const weight = weightTrend(series('weight_body_mass'), today);
  const composition = compositionNow(series, today, weight.current);
  const phase = goalPhase(goal, weight.current, composition.bodyFat);
  const energy = energyBalance(series, today);

  const startWeight = readingNear(series('weight_body_mass'), anchor);
  const startBodyFat = readingNear(series('body_fat_percentage'), anchor);
  const startValue = goal.kind === 'weight' ? startWeight?.value ?? null : startBodyFat?.value ?? null;
  let progress: number | null = null;
  if (startValue !== null && phase.current !== null && Math.abs(startValue - goal.target) > 1e-6) {
    progress = Math.min(1, Math.max(0, (startValue - phase.current) / (startValue - goal.target)));
  }
  if (phase.phase === 'maintain') progress = 1;

  const weightKg = weight.current?.value ?? null;
  // The lean share of a change only says something about this goal when weight
  // moved the goal's way: the share measured while gaining says nothing about a cut.
  const observed = observedLeanShare(series, anchor, today);
  const goalDirection = phase.phase === 'cut' ? -1 : phase.phase === 'bulk' ? 1 : 0;
  const leanShare = observed && Math.sign(observed.weightChangeKg) === goalDirection ? observed : null;
  const monthsBase = { months: 6 } as const;

  if (!phase.phase || weightKg === null) {
    return {
      goal, today, anchor, weight, composition, phase,
      start: { weight: startWeight, bodyFat: startBodyFat, value: startValue },
      progress, band: null, pace: null, fit: 'unknown', energy, targets: null,
      goalWeightKg: goal.kind === 'weight' ? goal.target : null,
      scenarios: [], bodyFatAtGoal: null, projection: null, leanShare,
      effects: {
        rate: null, lean: null, recovery: [],
        activity: activityComparison(series, workoutDays, anchor, today),
        activeShare: activeShareOfMaintenance(series, today, energy.maintenance),
      },
      consistency: macroConsistency(series, addDays(today, -TREND_DAYS), addDays(today, -1)),
      months: monthlyIntake(series, today, monthsBase),
      adherence: null,
    };
  }

  const band = recommendedBand(phase.phase, composition.bodyFat?.value ?? null, sex);
  const pace = effectivePace(phase.phase, band, weightKg, goal.paceKgPerWeek);
  const fit = trendFit(phase.phase, band, weight.ratePct);
  const targets = nutritionTargets({ phase: phase.phase, maintenance: energy.maintenance, paceKgPerWeek: pace.kgPerWeek, weightKg, leanKg: composition.leanKg });

  let scenarios: GoalWeightScenario[] = [];
  let goalWeightKg: number | null = null;
  let bodyFatAtGoal: number | null = null;
  if (goal.kind === 'body_fat') {
    if (composition.fatKg !== null) {
      scenarios = goalWeightScenarios({ phase: phase.phase, weightKg, fatKg: composition.fatKg, targetPct: goal.target, observed: leanShare });
      goalWeightKg = phase.phase === 'maintain' ? weightKg : scenarios.find(s => s.id === 'realistic')?.goalWeightKg ?? null;
    }
  } else {
    goalWeightKg = goal.target;
    if (composition.fatKg !== null && phase.phase !== 'maintain') {
      bodyFatAtGoal = projectedBodyFat(weightKg, composition.fatKg, goal.target, realisticShare(phase.phase));
    }
  }

  const rateText = (kgPerWeek: number) => `${formatSignedKg(kgPerWeek, system)}/week`;
  const projection =
    goalWeightKg !== null
      ? projectArrival({
          phase: phase.phase,
          remainingKg: goalWeightKg - weightKg,
          weightKg,
          band,
          pace,
          trendKgPerWeek: weight.rateKgPerWeek,
          today,
          formatRate: rateText,
        })
      : null;

  return {
    goal,
    today,
    anchor,
    weight,
    composition,
    phase,
    start: { weight: startWeight, bodyFat: startBodyFat, value: startValue },
    progress,
    band,
    pace,
    fit,
    energy,
    targets,
    goalWeightKg,
    scenarios,
    bodyFatAtGoal,
    projection,
    leanShare,
    effects: {
      rate: rateEffect(phase.phase, weight.ratePct, weight.rateKgPerWeek === null ? null : formatKg(Math.abs(weight.rateKgPerWeek), system)),
      lean: leanEffect(phase.phase, leanShare, kg => formatSignedKg(kg, system)),
      recovery: recoveryEffects(series, workoutDays, today, system, (weight.rateKgPerWeek ?? 0) < 0),
      activity: activityComparison(series, workoutDays, anchor, today),
      activeShare: activeShareOfMaintenance(series, today, energy.maintenance),
    },
    consistency: macroConsistency(series, addDays(today, -TREND_DAYS), addDays(today, -1)),
    months: monthlyIntake(series, today, { ...monthsBase, proteinFloor: targets.proteinFloor }),
    adherence: adherence(series, today, targets),
  };
}
