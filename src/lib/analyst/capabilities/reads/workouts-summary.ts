// ── Workout summary (SERVER ONLY) ───────────────────────
//
// Totals, the sessions per week, minutes as h:mm, a count and time by type, a
// breakdown by month when the window is long, and the latest three sessions. The
// types present in the window are always listed so a wrong `type` can be corrected.
// When the window ends today, `rollup` carries the figures the older get_workouts
// returned (`workoutsFor`), each with a display string.

import { workoutTotals } from '../../../analytics/workouts';
import { formatDurationHm, formatMetricWithUnit } from '../../../metrics/format';
import { workoutsFor } from '../../retrieval';
import { manifestEntry } from '../manifest';
import { ok } from '../envelope';
import type { CapabilityContext } from '../types';
import { asWindow, guarded, windowLength, type Args, type Read } from './common';
import { rowOf } from './workout-rows';
import { selectWorkouts } from './workouts-select';

const entry = () => manifestEntry('workouts.summary');
const BY_MONTH_OVER_DAYS = 62;

const perWeek = (sessions: number, days: number): string => (sessions / (days / 7)).toFixed(1);

export function readWorkoutSummary(args: Args, ctx: CapabilityContext): Promise<Read> {
  return guarded(entry(), ctx, async () => {
    const picked = await selectWorkouts(args, ctx, 'workouts.summary');
    if (!picked.ok) return picked.env;
    const { sel } = picked;
    const days = windowLength(sel.window);
    const t = workoutTotals(sel.chosen);

    const display: Record<string, string> = {
      duration: formatDurationHm(t.minutes),
      durationPerSession: formatDurationHm(t.minutesPerSession),
      sessionsPerWeek: perWeek(t.sessions, days),
    };
    if (t.calorieSessions > 0) display.calories = formatMetricWithUnit('active_energy', t.calories, ctx.system);
    if (t.distanceSessions > 0) display.distance = formatMetricWithUnit('distance_walking_running', t.distanceKm, ctx.system);

    const byType = new Map<string, { sessions: number; minutes: number }>();
    for (const v of sel.chosen) {
      const cur = byType.get(v.workout_type) ?? { sessions: 0, minutes: 0 };
      byType.set(v.workout_type, { sessions: cur.sessions + 1, minutes: cur.minutes + v.duration_minutes });
    }
    const data: Record<string, unknown> = {
      totals: {
        sessions: t.sessions,
        display,
        recorded: `${t.calorieSessions} of ${t.sessions} sessions recorded calories; ${t.distanceSessions} recorded a distance.`,
      },
      byType: [...byType.entries()]
        .sort((a, b) => b[1].sessions - a[1].sessions || a[0].localeCompare(b[0]))
        .map(([type, v]) => ({ type, sessions: v.sessions, display: { duration: formatDurationHm(v.minutes) } })),
      typesInWindow: sel.typesInWindow,
    };

    if (days > BY_MONTH_OVER_DAYS) {
      const months = new Map<string, { sessions: number; minutes: number; types: Map<string, number> }>();
      for (const v of sel.chosen) {
        const m = months.get(v.key.slice(0, 7)) ?? { sessions: 0, minutes: 0, types: new Map<string, number>() };
        m.sessions += 1;
        m.minutes += v.duration_minutes;
        m.types.set(v.workout_type, (m.types.get(v.workout_type) ?? 0) + 1);
        months.set(v.key.slice(0, 7), m);
      }
      data.byMonth = [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, m]) => ({
          month,
          sessions: m.sessions,
          display: { duration: formatDurationHm(m.minutes) },
          types: [...m.types.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, sessions]) => ({ type, sessions })),
        }));
    }

    data.latest = [...sel.chosen].sort((a, b) => b.start_time.localeCompare(a.start_time)).slice(0, 3).map(v => rowOf(v, ctx.system));

    let read = sel.chosen.length;
    // The older roll-up, for a window that ends today and is not narrowed to one type.
    if (sel.window.end === ctx.refKey && !sel.type) {
      const built = workoutsFor(days, ctx.refKey);
      const w = built.workouts;
      ctx.access.fetched.workouts = w;
      read = built.recordsRead;
      data.rollup = {
        window: { start: w.window.startKey, end: w.window.endKey },
        sessions: w.sessions,
        sessionsPerWeek: w.sessionsPerWeek,
        minutes: w.minutes,
        calories: w.calories,
        calorieSessions: w.calorieSessions,
        byType: w.byType.map(b => ({ type: b.type, count: b.count, minutes: b.minutes, display: { minutes: formatDurationHm(b.minutes) } })),
        recent: w.recent,
        prior: w.prior,
        display: {
          sessionsPerWeek: w.sessionsPerWeek.toFixed(1),
          minutes: formatDurationHm(w.minutes),
          ...(w.calories !== null ? { calories: formatMetricWithUnit('active_energy', w.calories, ctx.system) } : {}),
        },
      };
    }
    ctx.access.fetched.recordsRead += read;
    ctx.access.fetched.log.push(`workouts ${sel.window.start}..${sel.window.end}${sel.type ? `, ${sel.type}` : ''}`);
    return ok(entry(), data, { window: asWindow(sel.window) });
  });
}
