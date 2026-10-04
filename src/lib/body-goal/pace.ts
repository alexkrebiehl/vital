// ── Body goal: recommended pace ─────────────────────────
//
// The app recommends a band (as % of body weight per week) and the reader may
// set their own pace instead. The effective pace is the reader's when set,
// otherwise the middle of the band. The DIRECTION always follows the phase —
// a stored pace is used for its size only — so a goal that is crossed (a cut
// that overshoots into "gain back to target") never pushes the wrong way.
//
// How the current trend compares with the band is described, never judged:
// "faster than recommended" and "slower than recommended" are both just facts
// about the data, and there is no notion of being behind.

import { BODY_FAT_BANDS, BULK_BAND, CUT_BANDS, STEADY_PCT } from './constants';
import type { GoalPhase } from './phase';

export type BodyFatLevel = 'lean' | 'moderate' | 'higher' | 'unknown';

export interface PaceBand {
  /** % of body weight per week, as positive sizes. */
  minPct: number;
  maxPct: number;
  level: BodyFatLevel | null;
  /** Why this band, in one sentence. */
  basis: string;
}

export function bodyFatLevel(bodyFatPct: number | null, sex: 'male' | 'female' | null): BodyFatLevel {
  if (bodyFatPct === null) return 'unknown';
  const bands = BODY_FAT_BANDS[sex ?? 'male'];
  if (bodyFatPct < bands.lean) return 'lean';
  if (bodyFatPct > bands.higher) return 'higher';
  return 'moderate';
}

export function recommendedBand(phase: GoalPhase, bodyFatPct: number | null, sex: 'male' | 'female' | null): PaceBand {
  if (phase === 'maintain') {
    return { minPct: 0, maxPct: 0, level: null, basis: 'At the goal, the aim is to hold weight steady.' };
  }
  if (phase === 'bulk') {
    return {
      minPct: BULK_BAND.min,
      maxPct: BULK_BAND.max,
      level: null,
      basis: 'Gaining faster than about 0.5 % of body weight a week adds mostly fat rather than muscle.',
    };
  }
  const level = bodyFatLevel(bodyFatPct, sex);
  const band = CUT_BANDS[level];
  const sexNote = sex === null && bodyFatPct !== null ? ' (body-fat bands for men are used until sex is set in Settings)' : '';
  const basis =
    level === 'unknown'
      ? 'Without a body-fat reading the general range is used: 0.5–1 % of body weight a week.'
      : level === 'lean'
        ? `At ${bodyFatPct!.toFixed(1)} % body fat you are lean${sexNote}, and slower cuts keep more muscle.`
        : level === 'higher'
          ? `At ${bodyFatPct!.toFixed(1)} % body fat${sexNote}, a faster cut costs little muscle.`
          : `At ${bodyFatPct!.toFixed(1)} % body fat${sexNote}, a moderate pace balances speed against keeping muscle.`;
  return { minPct: band.min, maxPct: band.max, level, basis };
}

export interface EffectivePace {
  /** Signed kg/week: negative when cutting. */
  kgPerWeek: number;
  /** Size as % of body weight per week. */
  pct: number;
  source: 'recommended' | 'custom';
}

/** The pace the targets and projections use. */
export function effectivePace(phase: GoalPhase, band: PaceBand, weightKg: number, customKgPerWeek: number | null): EffectivePace {
  if (phase === 'maintain') return { kgPerWeek: 0, pct: 0, source: customKgPerWeek === null ? 'recommended' : 'custom' };
  const sign = phase === 'cut' ? -1 : 1;
  if (customKgPerWeek !== null && customKgPerWeek !== 0) {
    const size = Math.abs(customKgPerWeek);
    return { kgPerWeek: sign * size, pct: (size / weightKg) * 100, source: 'custom' };
  }
  const pct = (band.minPct + band.maxPct) / 2;
  return { kgPerWeek: (sign * pct * weightKg) / 100, pct, source: 'recommended' };
}

export type TrendFit = 'within' | 'faster' | 'slower' | 'steady' | 'opposite' | 'drifting' | 'unknown';

/**
 * Where the measured trend sits relative to the band. `opposite` means the
 * trend is moving away from the target; `steady` means it is not moving much
 * (under a tenth of the band's lower edge). At maintenance, `drifting` means
 * weight is moving more than STEADY_PCT a week either way.
 */
export function trendFit(phase: GoalPhase, band: PaceBand, ratePct: number | null): TrendFit {
  if (ratePct === null) return 'unknown';
  if (phase === 'maintain') return Math.abs(ratePct) <= STEADY_PCT ? 'within' : 'drifting';
  const toward = phase === 'cut' ? -ratePct : ratePct;
  if (Math.abs(toward) < Math.max(0.05, band.minPct * 0.1)) return 'steady';
  if (toward < 0) return 'opposite';
  if (toward < band.minPct) return 'slower';
  if (toward > band.maxPct) return 'faster';
  return 'within';
}
