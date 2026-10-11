// ── Sleep nights and the sleep summary (SERVER ONLY) ────

import { hasSleepStages, type SleepDay } from '../../../adapters/dataset';
import { mean } from '../../../analytics/stats';
import { formatDurationHm } from '../../../metrics/format';
import { ok, pageRows } from '../envelope';
import { manifestEntry } from '../manifest';
import type { CapabilityContext } from '../types';
import { asWindow, guarded, windowLength, type Args, type Read } from './common';
import { nightRow, selectNights, sortNights, type SleepSelection } from './sleep-select';
import { weekStart } from './series-points';

const MAX_CHARS = 9_500;
const WEEKLY_UP_TO_DAYS = 92;
const CITES = ['sleep_analysis', 'sleep_in_bed'];

/** Sleep can be cited on a card after any successful read of it. */
function cite(ctx: CapabilityContext, sel: SleepSelection): void {
  for (const id of CITES) ctx.access.fetched.citable.add(id);
  ctx.access.fetched.recordsRead += sel.nights.length;
  ctx.access.fetched.log.push(`sleep ${sel.window.start}..${sel.window.end}`);
}

const meanHm = (nights: SleepDay[], pick: (n: SleepDay) => number): string => formatDurationHm(mean(nights.map(pick)));

/** Time in bed over every night; asleep and the stages over the nights that carry them. */
function averages(nights: SleepDay[]): Record<string, string> {
  const staged = nights.filter(hasSleepStages);
  const out: Record<string, string> = { inBed: meanHm(nights, n => n.inBedMinutes) };
  if (staged.length === 0) return out;
  out.asleep = meanHm(staged, n => n.asleepMinutes);
  out.deep = meanHm(staged, n => n.stages.deep);
  out.core = meanHm(staged, n => n.stages.core);
  out.rem = meanHm(staged, n => n.stages.rem);
  out.awake = meanHm(staged, n => n.stages.awake);
  return out;
}

function summaryData(sel: SleepSelection): Record<string, unknown> {
  const n = sel.nights.length;
  const staged = sel.nights.filter(hasSleepStages);
  const bare = n - staged.length;
  const weekly = windowLength(sel.window) <= WEEKLY_UP_TO_DAYS;
  const groups = new Map<string, SleepDay[]>();
  for (const night of sel.nights) {
    const k = weekly ? weekStart(night.key) : night.key.slice(0, 7);
    groups.set(k, [...(groups.get(k) ?? []), night]);
  }
  const ranked = [...staged].sort((a, b) => b.asleepMinutes - a.asleepMinutes || b.key.localeCompare(a.key));
  const short = (night: SleepDay) => ({ day: night.key, asleep: night.asleepMinutes, display: { asleep: formatDurationHm(night.asleepMinutes), inBed: formatDurationHm(night.inBedMinutes) } });
  const period = (ns: SleepDay[]) => {
    const a = averages(ns);
    return a.asleep ? { asleep: a.asleep, inBed: a.inBed } : { inBed: a.inBed };
  };
  return {
    nights: n,
    stageCoverage:
      bare === 0
        ? `All ${n} nights carry a stage split.`
        : `${staged.length} of ${n} nights carry a stage split; the other ${bare} record time in bed only and are left out of the time-asleep and stage figures.`,
    display: averages(sel.nights),
    periodKind: weekly ? 'week' : 'month',
    byPeriod: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([p, ns]) => ({ period: p, nights: ns.length, display: period(ns) })),
    longest: ranked.slice(0, 3).map(short),
    shortest: ranked.slice(-3).reverse().map(short),
  };
}

export function readSleepSummary(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('sleep.summary');
  return guarded(entry, ctx, async () => {
    const picked = await selectNights(args, ctx, 'sleep.summary');
    if (!picked.ok) return picked.env;
    cite(ctx, picked.sel);
    return ok(entry, summaryData(picked.sel), { window: asWindow(picked.sel.window) });
  });
}

export function readSleepNights(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('sleep.nights');
  return guarded(entry, ctx, async () => {
    const picked = await selectNights(args, ctx, 'sleep.nights');
    if (!picked.ok) return picked.env;
    const { sel } = picked;
    cite(ctx, sel);
    if (sel.view === 'summary') return ok(manifestEntry('sleep.summary'), summaryData(sel), { window: asWindow(sel.window) });
    const ordered = sortNights(sel.nights, sel.sort ?? 'date', sel.order, ctx.tz);
    const { rows, page } = pageRows(ordered, { limit: sel.paging.limit, offset: sel.paging.offset, maxChars: MAX_CHARS, render: n => nightRow(n, ctx.tz) });
    return ok(entry, { nights: rows }, { window: asWindow(sel.window), page });
  });
}
