// ── Choosing the sleep nights a call asks for (SERVER ONLY) ─
//
// From `sleepSeries()`: one entry per night, keyed by the waking day. A night whose
// record carries only an in-bed window has no stage split and therefore no time
// asleep; it is kept, flagged `hasStages: false`, and never given an asleep value.

import { hasSleepStages, sleepSeries, type SleepDay } from '../../../adapters/dataset';
import { clockLabel } from '../../../analytics/windows';
import { formatDurationHm } from '../../../metrics/format';
import { manifestEntry } from '../manifest';
import type { CapabilityContext, Coverage } from '../types';
import type { ResolvedWindow } from '../window';
import { choiceProblem, emptyWindow, inWindow, pagingOf, problemsOf, spanOf, windowOf, type Args, type Paging, type Read } from './common';

export const VIEWS = ['nights', 'summary'] as const;
export const SORTS = ['date', 'asleep', 'inBed', 'deep', 'rem', 'core', 'awake', 'bedtime', 'wake'] as const;
export const DEFAULT_LIMIT = 14;
export const MAX_LIMIT = 31;
export type Sort = (typeof SORTS)[number];

/** Every night, in-bed-only ones included. */
export async function sleepCoverage(_ctx?: CapabilityContext): Promise<Coverage> {
  return spanOf(sleepSeries().map(n => n.key), 'nights');
}

export interface SleepSelection {
  window: ResolvedWindow;
  /** The nights in the window, oldest first. */
  nights: SleepDay[];
  view: 'nights' | 'summary';
  sort: Sort | null;
  order: 'asc' | 'desc';
  paging: Paging;
}

/** Minutes since local midnight of an instant. */
export function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** A bedtime counts from 18:00, so 11:30 PM sorts before 12:30 AM. */
const bedtimeKey = (iso: string, tz: string): number => (minutesOfDay(iso, tz) - 18 * 60 + 1440) % 1440;

export function sortValue(n: SleepDay, sort: Sort, tz: string): number | string | null {
  const staged = hasSleepStages(n);
  switch (sort) {
    case 'date': return n.key;
    case 'asleep': return staged ? n.asleepMinutes : null;
    case 'inBed': return n.inBedMinutes;
    case 'deep': case 'rem': case 'core': case 'awake': return staged ? n.stages[sort] : null;
    case 'bedtime': return bedtimeKey(n.bedtime, tz);
    case 'wake': return minutesOfDay(n.wakeTime, tz);
  }
}

export function sortNights(nights: SleepDay[], sort: Sort, order: 'asc' | 'desc', tz: string): SleepDay[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...nights].sort((a, b) => {
    const x = sortValue(a, sort, tz);
    const y = sortValue(b, sort, tz);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return c !== 0 ? dir * c : b.key.localeCompare(a.key);
  });
}

/** One night as the model reads it. A night without stages has no asleep value and no stages. */
export function nightRow(n: SleepDay, tz: string): Record<string, unknown> {
  const display: Record<string, string> = { inBed: formatDurationHm(n.inBedMinutes) };
  const row: Record<string, unknown> = { day: n.key, bedtime: clockLabel(n.bedtime, tz), wakeTime: clockLabel(n.wakeTime, tz), hasStages: hasSleepStages(n), inBed: n.inBedMinutes };
  if (hasSleepStages(n)) {
    row.asleep = n.asleepMinutes;
    display.asleep = formatDurationHm(n.asleepMinutes);
    const s = n.stages;
    row.stages = {
      deep: s.deep,
      core: s.core,
      rem: s.rem,
      awake: s.awake,
      display: { deep: formatDurationHm(s.deep), core: formatDurationHm(s.core), rem: formatDurationHm(s.rem), awake: formatDurationHm(s.awake) },
    };
  }
  return { ...row, display };
}

export async function selectNights(args: Args, ctx: CapabilityContext, id: 'sleep.nights' | 'sleep.summary'): Promise<{ ok: true; sel: SleepSelection } | { ok: false; env: Read }> {
  const entry = manifestEntry(id);
  const problems = [...choiceProblem('view', args.view, VIEWS), ...choiceProblem('sort', args.sort, SORTS), ...choiceProblem('order', args.order, ['desc', 'asc'])];
  const paging = pagingOf(args, DEFAULT_LIMIT, MAX_LIMIT);
  if (!paging.ok) problems.push(...paging.problems);
  const win = windowOf(args, ctx, 14);
  if (!win.ok) problems.push(...win.problems);
  if (problems.length || !paging.ok || !win.ok) return { ok: false, env: problemsOf(entry, problems) };

  const w = win.window;
  const nights = sleepSeries().filter(n => inWindow(w, n.key));
  if (nights.length === 0) return { ok: false, env: emptyWindow(entry, w, await sleepCoverage(ctx)) };

  const sort = (args.sort as Sort | undefined) ?? null;
  // An explicit sort always wants nights; otherwise a long window is summarised before it is paged.
  const view = (args.view as 'nights' | 'summary' | undefined) ?? (sort === null && nights.length > MAX_LIMIT ? 'summary' : 'nights');
  return { ok: true, sel: { window: w, nights, view, sort, order: (args.order as 'asc' | 'desc' | undefined) ?? 'desc', paging: paging.paging } };
}
