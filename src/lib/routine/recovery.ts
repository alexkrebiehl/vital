// ── Recovery indicators ─────────────────────────────────
//
// What the body says about readiness to progress, from Apple Health data
// already in the dataset plus the training sessions themselves:
//
//   resting_hr        mean of the last 7 days vs the 28 days before them (bpm)
//   hrv               same windows (ms)
//   sleep_hours       mean time asleep over the last 7 nights (h)
//   body_weight_rate  least-squares slope of body weight over 28 days (kg / week)
//   training_load     training sessions in the last 7 days vs the weekly mean
//                     of the 28 days before them (% change)
//
// Every indicator is reported with its numbers and windows. A plan's recovery
// gates decide which ones matter and how much (`watch` or `warn`); without a
// gate an indicator is shown for information only.

import { addDays } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import { convertValue, displayUnit } from '../metrics/format';
import type { RecoveryGate, RecoverySignalId } from './types';

export interface DayValue {
  key: string;
  value: number;
}

export type RecoveryStatus = 'ok' | 'watch' | 'warn' | 'info' | 'unknown';

export interface RecoveryIndicator {
  signal: RecoverySignalId;
  label: string;
  /** Recent value, in display units. */
  current: number | null;
  /** Comparison value, in display units (null when the signal has none). */
  baseline: number | null;
  unit: string;
  /** Plain sentence with the numbers and windows. */
  text: string;
  status: RecoveryStatus;
  gate?: RecoveryGate;
  observations: number;
}

export interface RecoveryInputs {
  /** Daily series by metric id: resting_heart_rate, heart_rate_variability, sleep_analysis (minutes asleep), weight_body_mass (kg). */
  series: (metricId: string) => DayValue[];
  /** Local days on which a training session was logged. */
  trainingDays: string[];
  today: string;
  system: UnitSystem;
}

const LABELS: Record<RecoverySignalId, string> = {
  resting_hr: 'Resting heart rate',
  hrv: 'Heart rate variability',
  sleep_hours: 'Sleep',
  body_weight_rate: 'Body-weight trend',
  training_load: 'Training load',
};

function between(points: DayValue[], from: string, to: string): number[] {
  return points.filter(p => p.key >= from && p.key <= to && Number.isFinite(p.value)).map(p => p.value);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Least-squares slope in value per day. */
function slopePerDay(points: DayValue[]): number | null {
  if (points.length < 4) return null;
  const x0 = Date.parse(`${points[0].key}T12:00:00Z`);
  const xs = points.map(p => (Date.parse(`${p.key}T12:00:00Z`) - x0) / 86_400_000);
  const ys = points.map(p => p.value);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

function judgeGate(gate: RecoveryGate | undefined, current: number | null, baseline: number | null): RecoveryStatus {
  if (!gate) return 'info';
  if (current === null) return 'unknown';
  const threshold = gate.threshold ?? 0;
  let tripped = false;
  switch (gate.rule) {
    case 'below': tripped = current < threshold; break;
    case 'above': tripped = current > threshold; break;
    case 'rising': tripped = baseline !== null && current - baseline >= threshold; break;
    case 'falling': tripped = baseline !== null && baseline - current >= threshold; break;
  }
  return tripped ? gate.severity : 'ok';
}

export function recoveryIndicators(inputs: RecoveryInputs, gates: RecoveryGate[]): RecoveryIndicator[] {
  const { today, system } = inputs;
  const recentFrom = addDays(today, -6);
  const baseFrom = addDays(today, -34);
  const baseTo = addDays(today, -7);
  const gateFor = (s: RecoverySignalId) => gates.find(g => g.signal === s);
  const out: RecoveryIndicator[] = [];

  for (const [signal, metricId, unit] of [
    ['resting_hr', 'resting_heart_rate', 'bpm'],
    ['hrv', 'heart_rate_variability', 'ms'],
  ] as const) {
    const series = inputs.series(metricId);
    const recent = between(series, recentFrom, today);
    const base = between(series, baseFrom, baseTo);
    const current = mean(recent);
    const baseline = mean(base);
    const gate = gateFor(signal);
    out.push({
      signal,
      label: LABELS[signal],
      current: current === null ? null : round(current),
      baseline: baseline === null ? null : round(baseline),
      unit,
      observations: recent.length,
      status: judgeGate(gate, current, baseline),
      gate,
      text:
        current === null
          ? `No ${LABELS[signal].toLowerCase()} readings in the last 7 days.`
          : `${round(current)} ${unit} over the last 7 days${baseline === null ? '' : ` vs ${round(baseline)} ${unit} over the 28 days before`}.`,
    });
  }

  {
    const nights = between(inputs.series('sleep_analysis'), recentFrom, today).map(m => m / 60);
    const current = mean(nights);
    const gate = gateFor('sleep_hours');
    out.push({
      signal: 'sleep_hours',
      label: LABELS.sleep_hours,
      current: current === null ? null : round(current, 2),
      baseline: null,
      unit: 'h',
      observations: nights.length,
      status: judgeGate(gate, current, null),
      gate,
      text: current === null ? 'No sleep recorded in the last 7 nights.' : `${round(current, 2)} h asleep on average over the last ${nights.length} night${nights.length === 1 ? '' : 's'}.`,
    });
  }

  {
    const weights = inputs.series('weight_body_mass').filter(p => p.key >= addDays(today, -27) && p.key <= today);
    const perDay = slopePerDay(weights);
    const kgPerWeek = perDay === null ? null : perDay * 7;
    const gate = gateFor('body_weight_rate');
    const shown = kgPerWeek === null ? null : round(convertValue(kgPerWeek, 'kg', system), 2);
    const unit = `${displayUnit('kg', system)}/week`;
    out.push({
      signal: 'body_weight_rate',
      label: LABELS.body_weight_rate,
      current: shown,
      baseline: null,
      unit,
      observations: weights.length,
      // Gates are written in kg/week regardless of the display unit.
      status: judgeGate(gate, kgPerWeek, null),
      gate,
      text:
        shown === null
          ? 'Not enough weigh-ins in the last 28 days for a trend.'
          : `${shown > 0 ? '+' : ''}${shown} ${unit} over the last 28 days (${weights.length} weigh-ins).`,
    });
  }

  {
    const recent = inputs.trainingDays.filter(d => d >= recentFrom && d <= today).length;
    const base = inputs.trainingDays.filter(d => d >= baseFrom && d <= baseTo).length / 4;
    const change = base > 0 ? ((recent - base) / base) * 100 : null;
    const gate = gateFor('training_load');
    out.push({
      signal: 'training_load',
      label: LABELS.training_load,
      current: recent,
      baseline: round(base),
      unit: 'sessions/week',
      observations: recent,
      status: judgeGate(gate, change, 0),
      gate,
      text:
        base > 0
          ? `${recent} session${recent === 1 ? '' : 's'} in the last 7 days vs ${round(base)} a week before that (${change! >= 0 ? '+' : ''}${Math.round(change!)}%).`
          : `${recent} session${recent === 1 ? '' : 's'} in the last 7 days.`,
    });
  }

  return out;
}

/** The worst gated status, for a one-word recovery chip. */
export function recoverySummary(indicators: RecoveryIndicator[]): { status: 'ok' | 'watch' | 'warn' | 'unknown'; text: string } {
  const gated = indicators.filter(i => i.gate);
  if (gated.length === 0) return { status: 'unknown', text: 'No recovery gates are set in this plan.' };
  const warn = gated.filter(i => i.status === 'warn');
  const watch = gated.filter(i => i.status === 'watch');
  if (warn.length) return { status: 'warn', text: `${warn.map(i => i.label).join(', ')} outside the plan's limits.` };
  if (watch.length) return { status: 'watch', text: `Watch: ${watch.map(i => i.label.toLowerCase()).join(', ')}.` };
  if (gated.every(i => i.status === 'unknown')) return { status: 'unknown', text: 'Not enough recent data to check recovery.' };
  return { status: 'ok', text: 'Recovery signals are inside the plan’s limits.' };
}
