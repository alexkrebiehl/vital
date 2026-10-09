// ── Workout sessions (SERVER ONLY) ──────────────────────
//
// Each session in a window, with its date, time, type, duration and whatever it
// recorded, in the registry's formatters. `detail` adds the exercises of the
// strength session that is the same workout (matched by time, as the Workouts
// page matches it). The strength sessions are read once per question, and a read
// that fails leaves them out with a scrubbed note, never failing the call.

import { manifestEntry } from '../manifest';
import { ok, pageRows } from '../envelope';
import type { CapabilityContext } from '../types';
import { asWindow, guarded, type Args, type Read } from './common';
import { loadStrength, rowOf, strengthOf, type Row } from './workout-rows';
import { selectWorkouts } from './workouts-select';

const entry = () => manifestEntry('workouts.sessions');
const MAX_CHARS = 9_500;

export function readWorkoutSessions(args: Args, ctx: CapabilityContext): Promise<Read> {
  return guarded(entry(), ctx, async () => {
    const picked = await selectWorkouts(args, ctx, 'workouts.sessions');
    if (!picked.ok) return picked.env;
    const { sel } = picked;

    const join = sel.detail ? await loadStrength(ctx) : null;
    const render = (v: (typeof sel.chosen)[number]): Row => {
      const row = rowOf(v, ctx.system);
      const matched = join?.forWorkout(v);
      return matched ? { ...row, strength: strengthOf(matched) } : row;
    };
    const { rows, page } = pageRows(sel.chosen, { limit: sel.paging.limit, offset: sel.paging.offset, maxChars: MAX_CHARS, render });

    ctx.access.fetched.recordsRead += rows.length;
    ctx.access.fetched.log.push(`workouts ${sel.window.start}..${sel.window.end}${sel.type ? `, ${sel.type}` : ''}`);
    const data = {
      sessions: rows,
      typesInWindow: sel.typesInWindow,
      ...(join?.notes.length ? { notes: join.notes } : {}),
    };
    return ok(entry(), data, { window: asWindow(sel.window), page, ...(rows.length === 0 ? { next: `There are no sessions from offset ${sel.paging.offset}; ${page.total} match.` } : {}) });
  });
}
