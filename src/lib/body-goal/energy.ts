// ── Body goal: energy balance and maintenance ───────────
//
// Two independent estimates of maintenance calories (TDEE), shown side by side:
//
//   weight trend  mean logged calories on complete days − the weight trend in
//                 energy (kg/day × 7,700). Over four weeks this cancels most of
//                 the noise in both, and needs no model of the reader's body.
//   device        mean of basal + active energy on days with both. Apple's
//                 basal figure is computed from body weight, so it falls as
//                 weight falls — that alone is not metabolic slowdown.
//
// No food log at all is the common case, not an error: most people do not
// count calories. Then maintenance comes from the device alone, and the
// weight trend still says how big the deficit or surplus is
// (`trendBalance`), because that needs only weigh-ins.
//
// Partial logs: a logged day far below the window's median is almost always a
// day the reader stopped logging, not a day they ate 800 kcal. Those days are
// left out of the intake mean and listed, so the exclusion is visible. Days
// with no log are never counted as zero.

import { addDays } from '../analytics/windows';
import { linearSlope, mean, median } from '../analytics/stats';
import {
  ENERGY_AGREEMENT_KCAL,
  KCAL_PER_KG,
  MIN_DEVICE_DAYS,
  MIN_ENERGY_LOGGED_DAYS,
  MIN_ENERGY_WEIGH_INS,
  PARTIAL_LOG_SHARE,
  TREND_DAYS,
} from './constants';
import { between, type DayValue } from './trend';

export interface LoggedDays {
  /** Every logged day in the window. */
  logged: DayValue[];
  /** Logged days that look complete. */
  complete: DayValue[];
  /** Logged days that look partial (below the threshold, or flagged by the source). */
  partial: DayValue[];
  /** The calories below which a day counts as partial. */
  threshold: number | null;
}

/** Split logged calorie days into complete and partial ones. */
export function splitLoggedDays(points: (DayValue & { partial?: boolean })[]): LoggedDays {
  const values = points.map(p => p.value).filter(v => v > 0);
  const mid = values.length ? median(values) : NaN;
  const threshold = Number.isFinite(mid) ? mid * PARTIAL_LOG_SHARE : null;
  const complete: DayValue[] = [];
  const partial: DayValue[] = [];
  for (const p of points) {
    if (p.partial === true || (threshold !== null && p.value < threshold)) partial.push({ key: p.key, value: p.value });
    else complete.push({ key: p.key, value: p.value });
  }
  return { logged: points.map(p => ({ key: p.key, value: p.value })), complete, partial, threshold };
}

export type EnergyAgreement = 'agree' | 'trend-higher' | 'device-higher';

export interface EnergyBalance {
  /** The window, ending the day before `today` (today's totals are still accumulating). */
  from: string;
  to: string;
  days: LoggedDays;
  /** True when any calories are logged in the window. Most people do not log food. */
  foodLogged: boolean;
  /** Mean logged calories on complete days. */
  intake: number | null;
  /** Weight slope over the window, kg/week. */
  weightRateKgPerWeek: number | null;
  weighIns: number;
  /** Maintenance from the weight trend, kcal/day. */
  adaptive: number | null;
  adaptiveReason: string | null;
  /** Maintenance from basal + active energy, kcal/day. */
  device: number | null;
  deviceDays: number;
  deviceBasal: number | null;
  deviceActive: number | null;
  deviceReason: string | null;
  /** The estimate the targets use: the weight trend when there is one, else the device. */
  maintenance: number | null;
  maintenanceSource: 'weight-trend' | 'device' | null;
  /** Intake − maintenance, kcal/day. Negative is a deficit. */
  balance: number | null;
  /** The daily deficit (negative) or surplus the weight trend implies on its own — no food log needed. */
  trendBalance: number | null;
  agreement: EnergyAgreement | null;
  agreementText: string | null;
}

export function energyBalance(series: (id: string) => DayValue[], today: string): EnergyBalance {
  const to = addDays(today, -1);
  const from = addDays(today, -TREND_DAYS);
  const days = splitLoggedDays(between(series('dietary_energy'), from, to));
  const weights = between(series('weight_body_mass'), from, today);
  const slope = linearSlope(weights);
  const intake = days.complete.length ? mean(days.complete.map(d => d.value)) : null;

  let adaptive: number | null = null;
  let adaptiveReason: string | null = null;
  if (days.logged.length === 0) {
    adaptiveReason = 'No food is logged, so maintenance cannot be worked out from what you eat and how your weight moves.';
  } else if (days.complete.length < MIN_ENERGY_LOGGED_DAYS) {
    adaptiveReason = `Needs at least ${MIN_ENERGY_LOGGED_DAYS} complete logged days in the last ${TREND_DAYS}; there are ${days.complete.length}.`;
  } else if (weights.length < MIN_ENERGY_WEIGH_INS || slope === null) {
    adaptiveReason = `Needs at least ${MIN_ENERGY_WEIGH_INS} weigh-ins in the last ${TREND_DAYS} days; there are ${weights.length}.`;
  } else {
    adaptive = intake! - slope * KCAL_PER_KG;
  }

  const basal = new Map(between(series('basal_energy_burned'), from, to).map(p => [p.key, p.value]));
  const active = between(series('active_energy'), from, to);
  const both = active.filter(p => basal.has(p.key));
  const device = both.length >= MIN_DEVICE_DAYS ? mean(both.map(p => p.value + basal.get(p.key)!)) : null;
  const deviceReason =
    device !== null
      ? null
      : basal.size === 0
        ? 'No basal (resting) energy is recorded, so the device estimate cannot be formed.'
        : `Needs at least ${MIN_DEVICE_DAYS} days with both basal and active energy; there are ${both.length}.`;

  const maintenance = adaptive ?? device;
  let agreement: EnergyAgreement | null = null;
  let agreementText: string | null = null;
  if (adaptive !== null && device !== null) {
    const gap = adaptive - device;
    if (Math.abs(gap) <= ENERGY_AGREEMENT_KCAL) {
      agreement = 'agree';
      agreementText = `The two estimates agree within ${Math.round(Math.abs(gap))} kcal/day, so the food log looks broadly complete.`;
    } else if (gap > 0) {
      agreement = 'trend-higher';
      agreementText = `The weight trend implies ${Math.round(gap)} kcal/day more than the device estimate. Either the food log under-counts, or the device under-estimates what you burn.`;
    } else {
      agreement = 'device-higher';
      agreementText = `The device estimate is ${Math.round(-gap)} kcal/day above what the weight trend implies. Wearables often over-estimate active energy.`;
    }
  }

  return {
    from,
    to,
    days,
    foodLogged: days.logged.length > 0,
    intake,
    weightRateKgPerWeek: slope === null ? null : slope * 7,
    weighIns: weights.length,
    adaptive,
    adaptiveReason,
    device,
    deviceDays: both.length,
    deviceBasal: both.length ? mean(both.map(p => basal.get(p.key)!)) : null,
    deviceActive: both.length ? mean(both.map(p => p.value)) : null,
    deviceReason,
    maintenance,
    maintenanceSource: adaptive !== null ? 'weight-trend' : device !== null ? 'device' : null,
    balance: maintenance !== null && intake !== null ? intake - maintenance : null,
    trendBalance: slope === null ? null : slope * KCAL_PER_KG,
    agreement,
    agreementText,
  };
}
