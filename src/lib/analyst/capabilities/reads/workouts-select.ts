// ── Choosing the workouts a call asks for (SERVER ONLY) ─
//
// Shared by the sessions and the summary view: the arguments, the window, the type
// filter and the sort. The rows come from `workoutViews()` and a session's day is
// its `key`, the same day the Workouts pages put it on.

import { workoutList } from '../../../adapters/dataset';
import { workoutViews, type WorkoutView } from '../../../analytics/workouts';
import { manifestEntry } from '../manifest';
import type { CapabilityContext, Coverage } from '../types';
import type { ResolvedWindow } from '../window';
import { choiceProblem, emptyWindow, inWindow, pagingOf, problemsOf, spanOf, windowOf, type Args, type Paging, type Read } from './common';

export const VIEWS = ['sessions', 'summary'] as const;
export const SORTS = ['date', 'duration', 'calories', 'distance'] as const;
export const ORDERS = ['desc', 'asc'] as const;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 25;

export type Sort = (typeof SORTS)[number];

/** The recorded sessions of the installed dataset: first and last day, and how many. */
export async function workoutsCoverage(_ctx?: CapabilityContext): Promise<Coverage> {
  return spanOf(workoutViews(workoutList()).map(v => v.key), 'sessions');
}

export interface Selection {
  window: ResolvedWindow;
  /** Sessions of the chosen type in the window, sorted. */
  chosen: WorkoutView[];
  /** Every type in the window with its sessions, before the type filter. */
  typesInWindow: { type: string; sessions: number }[];
  type: string | null;
  sort: Sort;
  order: 'asc' | 'desc';
  detail: boolean;
  paging: Paging;
  /** Whether the window held any session at all, before the type filter. */
  windowSessions: number;
}

const lower = (s: string) => s.toLowerCase();

function typesOf(views: WorkoutView[]): { type: string; sessions: number }[] {
  const counts = new Map<string, number>();
  for (const v of views) counts.set(v.workout_type, (counts.get(v.workout_type) ?? 0) + 1);
  return [...counts.entries()].map(([type, sessions]) => ({ type, sessions })).sort((a, b) => b.sessions - a.sessions || a.type.localeCompare(b.type));
}

/** A session without the field sorts last, whichever way the sort runs. */
function compare(sort: Sort, order: 'asc' | 'desc'): (a: WorkoutView, b: WorkoutView) => number {
  const dir = order === 'asc' ? 1 : -1;
  const value = (v: WorkoutView): number | string | null =>
    sort === 'date' ? v.start_time : sort === 'duration' ? v.duration_minutes : sort === 'calories' ? v.calories_burned : v.distance_km ?? null;
  return (a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return c !== 0 ? dir * c : b.start_time.localeCompare(a.start_time) || a.id.localeCompare(b.id);
  };
}

export async function selectWorkouts(args: Args, ctx: CapabilityContext, id: 'workouts.sessions' | 'workouts.summary'): Promise<{ ok: true; sel: Selection } | { ok: false; env: Read }> {
  const entry = manifestEntry(id);
  const problems = [...choiceProblem('view', args.view, VIEWS), ...choiceProblem('sort', args.sort, SORTS), ...choiceProblem('order', args.order, ORDERS)];
  if (args.type !== undefined && typeof args.type !== 'string') problems.push('type must be text, e.g. "Running".');
  if (args.detail !== undefined && typeof args.detail !== 'boolean') problems.push('detail must be true or false.');
  const paging = pagingOf(args, DEFAULT_LIMIT, MAX_LIMIT);
  if (!paging.ok) problems.push(...paging.problems);
  const win = windowOf(args, ctx, 30);
  if (!win.ok) problems.push(...win.problems);
  if (problems.length || !paging.ok || !win.ok) return { ok: false, env: problemsOf(entry, problems) };

  const w = win.window;
  const views = workoutViews(workoutList()).filter(v => inWindow(w, v.key));
  const typesInWindow = typesOf(views);
  if (views.length === 0) return { ok: false, env: emptyWindow(entry, w, await workoutsCoverage(ctx)) };

  const asked = typeof args.type === 'string' && lower(args.type) !== 'all' && args.type.trim() !== '' ? args.type.trim() : null;
  let chosen = views;
  if (asked) {
    chosen = views.filter(v => lower(v.workout_type) === lower(asked));
    if (chosen.length === 0) {
      const anywhere = workoutViews(workoutList()).some(v => lower(v.workout_type) === lower(asked));
      if (anywhere) return { ok: false, env: emptyWindow(entry, w, await workoutsCoverage(ctx), { typesInWindow }) };
      return { ok: false, env: problemsOf(entry, [`No workouts of type "${asked}" are recorded. The types in this window are listed in typesInWindow.`], { typesInWindow }) };
    }
  }
  const sort = (args.sort as Sort | undefined) ?? 'date';
  const order = (args.order as 'asc' | 'desc' | undefined) ?? 'desc';
  chosen = [...chosen].sort(compare(sort, order));
  return { ok: true, sel: { window: w, chosen, typesInWindow, type: asked, sort, order, detail: args.detail === true, paging: paging.paging, windowSessions: views.length } };
}
