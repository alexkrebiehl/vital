// ── Apple Health workout ↔ source session matching ─────
//
// Training apps usually write their sessions to Apple Health too, so the same
// workout reaches Vital twice: once from Health Auto Export as a generic
// "Strength Training" record and once from the app with its exercises. They are
// matched by time — the pair whose intervals overlap the most, as long as the
// overlap covers most of the shorter one — so the workout dialog can show what
// was actually done.
//
// Pure and import-free, so browser code may use it.

import type { TrainingSession } from './types';

/** Share of the shorter interval that must overlap for two records to be the same workout. */
export const MATCH_MIN_OVERLAP = 0.5;
/** Slack for clocks that disagree about when a workout started or ended. */
export const MATCH_SLACK_MS = 5 * 60_000;

interface Interval {
  start_time: string;
  end_time: string;
}

/** Two instants, ISO strings. Shared by every source that has a start and an end. */
export interface TimeSpan {
  start: string;
  end: string;
}

export interface IntervalMatchOptions {
  /** Share of the shorter interval that must overlap. Default `MATCH_MIN_OVERLAP`. */
  minOverlap?: number;
  /** `a` is widened by this much on both sides before it is compared. Default `MATCH_SLACK_MS`. */
  slackMs?: number;
}

function overlapShare(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  const shorter = Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
  return overlap / shorter;
}

/**
 * How much of the shorter interval is shared, in [.., 1]; `null` when either
 * interval cannot be read. `a` is widened by `slackMs` on both sides, and `b`
 * is treated as at least one minute long.
 */
export function intervalOverlapShare(a: TimeSpan, b: TimeSpan, slackMs: number = MATCH_SLACK_MS): number | null {
  const as = Date.parse(a.start) - slackMs;
  const ae = Date.parse(a.end) + slackMs;
  const bs = Date.parse(b.start);
  const be = Date.parse(b.end);
  if (![as, ae, bs, be].every(Number.isFinite)) return null;
  return overlapShare(as, ae, bs, Math.max(be, bs + 60_000));
}

/**
 * True when two intervals are the same session: the overlap covers at least
 * `minOverlap` of the shorter one, after `a` is widened by `slackMs`.
 */
export function intervalsMatch(
  a: TimeSpan,
  b: TimeSpan,
  { minOverlap = MATCH_MIN_OVERLAP, slackMs = MATCH_SLACK_MS }: IntervalMatchOptions = {}
): boolean {
  const share = intervalOverlapShare(a, b, slackMs);
  return share !== null && share >= minOverlap;
}

/** The session that is the same workout as `workout`, or null. */
export function matchSession<S extends Pick<TrainingSession, 'startTime' | 'endTime'>>(
  workout: Interval,
  sessions: S[]
): S | null {
  const span: TimeSpan = { start: workout.start_time, end: workout.end_time };
  let best: S | null = null;
  let bestShare = 0;
  for (const s of sessions) {
    const share = intervalOverlapShare(span, { start: s.startTime, end: s.endTime });
    if (share !== null && share > bestShare) {
      best = s;
      bestShare = share;
    }
  }
  return best && intervalsMatch(span, { start: best.startTime, end: best.endTime }) ? best : null;
}
