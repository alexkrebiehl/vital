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

function overlapShare(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  const shorter = Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
  return overlap / shorter;
}

/** The session that is the same workout as `workout`, or null. */
export function matchSession<S extends Pick<TrainingSession, 'startTime' | 'endTime'>>(
  workout: Interval,
  sessions: S[]
): S | null {
  const ws = Date.parse(workout.start_time) - MATCH_SLACK_MS;
  const we = Date.parse(workout.end_time) + MATCH_SLACK_MS;
  if (!Number.isFinite(ws) || !Number.isFinite(we)) return null;
  let best: S | null = null;
  let bestShare = 0;
  for (const s of sessions) {
    const ss = Date.parse(s.startTime);
    const se = Date.parse(s.endTime);
    if (!Number.isFinite(ss) || !Number.isFinite(se)) continue;
    const share = overlapShare(ws, we, ss, Math.max(se, ss + 60_000));
    if (share > bestShare) {
      best = s;
      bestShare = share;
    }
  }
  return bestShare >= MATCH_MIN_OVERLAP ? best : null;
}
