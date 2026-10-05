// ── Body: what the data says, with or without a goal ────
//
// Everything about the body's direction that needs no target: the weight trend
// and which way it is going, the energy balance, how activity compares with
// the weeks before, the pace's costs, recovery signals and the food log's
// consistency. The Body page shows this before a goal is set; a goal adds the
// target, progress, arrival dates and calorie targets on top (see report.ts).
//
// Without a goal the reader's intent is unknown, so the trend is named for
// what it does — losing, gaining, holding steady — and read against the
// recommended range for that direction.

import { addDays } from '../analytics/windows';
import { formatMetricWithUnit } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import type { RecoveryIndicator } from '../routine/recovery';
import { compositionNow, observedLeanShare, type CompositionNow, type LeanShare } from './composition';
import { macroConsistency, type MacroConsistency } from './consistency';
import { TREND_DAYS } from './constants';
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
import { monthlyIntake, type MonthIntake } from './intake';
import { recommendedBand, trendFit, type PaceBand, type TrendFit } from './pace';
import { trendDirection, type GoalPhase } from './phase';
import { weightTrend, type DayValue, type WeightTrend } from './trend';

/** Days the goal-free lean share is measured over. */
export const READING_LEAN_DAYS = 90;

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

/** Which way weight is going, and how that compares with the recommended range for that direction. */
export interface TrendReading {
  phase: GoalPhase;
  band: PaceBand;
  fit: TrendFit;
}

export interface BodyReading {
  today: string;
  weight: WeightTrend;
  composition: CompositionNow;
  energy: EnergyBalance;
  /** The weight trend's direction; null when there is no trend. */
  direction: TrendReading | null;
  /** The lean share of the change over the window the effects read. */
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
}

export function formatKg(kg: number, system: UnitSystem): string {
  return formatMetricWithUnit('weight_body_mass', kg, system);
}

export function formatSignedKg(kg: number, system: UnitSystem): string {
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '';
  return `${sign}${formatKg(Math.abs(kg), system)}`;
}

/** The direction of the trend, the band for it and how the trend sits in it. */
export function readTrend(weight: WeightTrend, bodyFatPct: number | null, sex: 'male' | 'female' | null): TrendReading | null {
  const phase = trendDirection(weight.ratePct);
  if (phase === null) return null;
  const band = recommendedBand(phase, bodyFatPct, sex);
  return { phase, band, fit: trendFit(phase, band, weight.ratePct) };
}

export function bodyReading(inputs: BodyGoalInputs): BodyReading {
  const { series, workoutDays, today, sex, system } = inputs;
  const weight = weightTrend(series('weight_body_mass'), today);
  const composition = compositionNow(series, today, weight.current);
  const energy = energyBalance(series, today);
  const direction = readTrend(weight, composition.bodyFat?.value ?? null, sex);

  // The lean share is judged by the way weight moved over its own window, not
  // the last four weeks: a 90-day loss is read as a loss even if it has levelled off.
  const leanShare = observedLeanShare(series, addDays(today, -READING_LEAN_DAYS), today);
  const leanPhase: GoalPhase | null = leanShare ? (leanShare.weightChangeKg < 0 ? 'cut' : 'bulk') : null;

  return {
    today,
    weight,
    composition,
    energy,
    direction,
    leanShare,
    effects: {
      rate: direction
        ? rateEffect(direction.phase, weight.ratePct, weight.rateKgPerWeek === null ? null : formatKg(Math.abs(weight.rateKgPerWeek), system))
        : null,
      lean: leanPhase ? leanEffect(leanPhase, leanShare, kg => formatSignedKg(kg, system), `Over the last ${READING_LEAN_DAYS} days`) : null,
      recovery: recoveryEffects(series, workoutDays, today, system, (weight.rateKgPerWeek ?? 0) < 0),
      activity: activityComparison(series, workoutDays, null, today),
      activeShare: activeShareOfMaintenance(series, today, energy.maintenance),
    },
    consistency: macroConsistency(series, addDays(today, -TREND_DAYS), addDays(today, -1)),
    months: monthlyIntake(series, today, { months: 6 }),
  };
}
