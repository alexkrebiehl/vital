// ── Body goal: what drives the change, and how the body responds ─
//
// "Driving": intake against the target (see intake.ts) and activity — active
// energy, steps, exercise minutes and workouts — compared with the four weeks
// before the goal started, so the reader can see whether they are moving more
// or less than they were.
//
// "Responding": the measurable costs of the pace. Losing faster than ~1 % of
// body weight a week (or gaining faster than ~0.5 %) costs more muscle or adds
// more fat; recovery signals — resting heart rate up, HRV down, short sleep —
// are the early signs a deficit is biting. Each is described from the data and
// shown only when there is data for it.

import { addDays, diffDays } from '../analytics/windows';
import { mean } from '../analytics/stats';
import { recoveryIndicators, type RecoveryIndicator } from '../routine/recovery';
import type { RecoveryGate } from '../routine/types';
import type { UnitSystem } from '../prefs';
import { BULK_RISK_PCT, CHECK_IN_ADJUST_KCAL, CUT_RISK_PCT, TREND_DAYS } from './constants';
import type { LeanShare } from './composition';
import type { GoalPhase } from './phase';
import { between, type DayValue } from './trend';

export type EffectStatus = 'ok' | 'watch' | 'info';

export interface EffectItem {
  id: string;
  label: string;
  status: EffectStatus;
  text: string;
}

/** The recovery limits the body page reads the signals against, independent of any training plan. */
export const GOAL_RECOVERY_GATES: RecoveryGate[] = [
  { signal: 'resting_hr', rule: 'rising', threshold: 3, severity: 'watch' },
  { signal: 'hrv', rule: 'falling', threshold: 10, severity: 'watch' },
  { signal: 'sleep_hours', rule: 'below', threshold: 7, severity: 'watch' },
];

export interface ActivityRow {
  id: 'active_energy' | 'step_count' | 'apple_exercise_time' | 'workouts';
  label: string;
  unit: string;
  recent: number | null;
  before: number | null;
}

export interface ActivityComparison {
  recentFrom: string;
  recentTo: string;
  beforeFrom: string;
  beforeTo: string;
  /** "before the goal started" or "the four weeks before". */
  beforeLabel: string;
  rows: ActivityRow[];
}

/**
 * Activity now vs before. "Now" is the time since the goal started (at most
 * four weeks, ending yesterday); "before" is the four weeks before the start.
 * A goal younger than a week compares the last two weeks with the four before.
 */
export function activityComparison(
  series: (id: string) => DayValue[],
  workoutDays: string[],
  startedOn: string,
  today: string
): ActivityComparison {
  const recentTo = addDays(today, -1);
  let recentFrom = startedOn > addDays(today, -TREND_DAYS) ? startedOn : addDays(today, -TREND_DAYS);
  let beforeTo = addDays(startedOn, -1);
  let beforeLabel = 'the four weeks before the goal started';
  if (diffDays(recentFrom, recentTo) < 6) {
    recentFrom = addDays(today, -14);
    beforeTo = addDays(recentFrom, -1);
    beforeLabel = 'the four weeks before that';
  }
  const beforeFrom = addDays(beforeTo, -(TREND_DAYS - 1));

  const daily = (id: string, from: string, to: string) => {
    const values = between(series(id), from, to).map(p => p.value);
    return values.length ? mean(values) : null;
  };
  const perWeek = (from: string, to: string) => {
    const span = diffDays(from, to) + 1;
    const n = new Set(workoutDays.filter(d => d >= from && d <= to)).size;
    return span > 0 ? (n / span) * 7 : null;
  };
  const hasWorkouts = workoutDays.length > 0;
  const rows: ActivityRow[] = [
    { id: 'active_energy', label: 'Active energy', unit: 'kcal/day', recent: daily('active_energy', recentFrom, recentTo), before: daily('active_energy', beforeFrom, beforeTo) },
    { id: 'step_count', label: 'Steps', unit: 'per day', recent: daily('step_count', recentFrom, recentTo), before: daily('step_count', beforeFrom, beforeTo) },
    { id: 'apple_exercise_time', label: 'Exercise', unit: 'min/day', recent: daily('apple_exercise_time', recentFrom, recentTo), before: daily('apple_exercise_time', beforeFrom, beforeTo) },
    { id: 'workouts', label: 'Workout days', unit: 'per week', recent: hasWorkouts ? perWeek(recentFrom, recentTo) : null, before: hasWorkouts ? perWeek(beforeFrom, beforeTo) : null },
  ];
  return { recentFrom, recentTo, beforeFrom, beforeTo, beforeLabel, rows: rows.filter(r => r.recent !== null || r.before !== null) };
}

export function rateEffect(phase: GoalPhase, ratePct: number | null, formatRate: string | null): EffectItem | null {
  if (ratePct === null || phase === 'maintain' || formatRate === null) return null;
  const toward = phase === 'cut' ? -ratePct : ratePct;
  if (toward <= 0) return null;
  const pct = toward.toFixed(2);
  if (phase === 'cut') {
    return toward > CUT_RISK_PCT
      ? { id: 'rate', label: 'Pace of loss', status: 'watch', text: `Losing ${formatRate} a week is about ${pct} % of body weight. Above ~${CUT_RISK_PCT} % a week, more of the loss tends to be muscle, strength gains stall, and recovery and tendons have less to work with. Slowing down costs a little time and keeps more muscle.` }
      : { id: 'rate', label: 'Pace of loss', status: 'ok', text: `Losing ${formatRate} a week is about ${pct} % of body weight — inside the range that keeps muscle.` };
  }
  return toward > BULK_RISK_PCT
    ? { id: 'rate', label: 'Pace of gain', status: 'watch', text: `Gaining ${formatRate} a week is about ${pct} % of body weight. Past ~${BULK_RISK_PCT} % a week, most of the extra is fat rather than muscle.` }
    : { id: 'rate', label: 'Pace of gain', status: 'ok', text: `Gaining ${formatRate} a week is about ${pct} % of body weight — a pace where a good share can be muscle.` };
}

export function leanEffect(phase: GoalPhase, lean: LeanShare | null, formatKg: (kg: number) => string): EffectItem | null {
  if (!lean || phase === 'maintain') return null;
  const pct = Math.round(lean.share * 100);
  const text = `Since the goal started, weight changed ${formatKg(lean.weightChangeKg)} and lean mass ${formatKg(lean.leanChangeKg)} — about ${pct} % of the change. Scale body-fat readings are noisy (±3–5 points), so read this as a direction, alongside strength and a waist measurement.`;
  if (phase === 'cut') {
    return { id: 'lean', label: 'Lean mass', status: lean.share > 0.3 ? 'watch' : 'ok', text };
  }
  return { id: 'lean', label: 'Lean mass', status: lean.share < 0.25 ? 'watch' : 'ok', text };
}

/** Recovery signals read against the goal's gates, with advice for a diet rather than a training plan. */
export function recoveryEffects(
  series: (id: string) => DayValue[],
  workoutDays: string[],
  today: string,
  system: UnitSystem,
  /** True when the weight trend is falling — a deficit in fact, not just in intent. */
  losing: boolean
): (RecoveryIndicator & { goalAdvice: string | null })[] {
  const indicators = recoveryIndicators({ series, trainingDays: workoutDays, today, system }, GOAL_RECOVERY_GATES)
    .filter(i => i.signal === 'resting_hr' || i.signal === 'hrv' || i.signal === 'sleep_hours')
    .filter(i => i.observations > 0);
  return indicators.map(i => ({
    ...i,
    goalAdvice:
      i.status === 'watch' || i.status === 'warn'
        ? losing
          ? `In a deficit this is an early sign to ease off: add ${CHECK_IN_ADJUST_KCAL.min}–${CHECK_IN_ADJUST_KCAL.max} kcal a day or slow the pace for a week or two.`
          : 'Worth watching; it is less often a nutrition signal outside a deficit.'
        : null,
  }));
}

export function activeShareOfMaintenance(series: (id: string) => DayValue[], today: string, maintenance: number | null): number | null {
  if (maintenance === null || maintenance <= 0) return null;
  const values = between(series('active_energy'), addDays(today, -TREND_DAYS), addDays(today, -1)).map(p => p.value);
  return values.length ? mean(values) / maintenance : null;
}
