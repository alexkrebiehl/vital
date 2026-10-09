// ── get_sleep: nights, stages, bedtimes ─────────────────────────────────────
//
// 400 synthetic nights ending 2026-10-08. Every seventh night (index 3 mod 7) is an
// in-bed-only record: it carries no stage split and therefore no time asleep.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset, sleepSeries, hasSleepStages } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { capabilityById } from './registry';
import { DAYS, installTestDataset, REF } from './test-dataset.fake';
import { expectClean, sizeOf, testCtx } from './test-context.fake';
import type { PrivacyPolicy } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

type Night = { day: string; bedtime: string; wakeTime: string; hasStages: boolean; inBed: number; asleep?: number; stages?: { deep: number; core: number; rem: number; awake: number; display: Record<string, string> }; display: Record<string, string> };
const nightsCap = () => capabilityById('sleep.nights')!;
const summaryCap = () => capabilityById('sleep.summary')!;
const nights = (env: { data?: unknown }) => (env.data as { nights: Night[] }).nights;
const WIDE = { lastDays: 400 };

describe('nights: defaults', () => {
  it('lists the last 14 nights, newest first', async () => {
    const env = await nightsCap().read({}, testCtx());
    expect(env.status).toBe('ok');
    expect(env.window).toEqual({ start: addDays(REF, -13), end: REF, asked: 'lastDays 14 (default)' });
    const r = nights(env);
    expect(r).toHaveLength(14);
    expect(r.map(n => n.day)).toEqual([...r.map(n => n.day)].sort().reverse());
    expect(env.page).toMatchObject({ returned: 14, total: 14, offset: 0 });
    expectClean(env);
  });

  it('prints bedtime and wake time as local clock times and durations as h:mm', async () => {
    const n = nights(await nightsCap().read({}, testCtx())).find(x => x.hasStages)!;
    expect(n.bedtime).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(n.wakeTime).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(n.display.asleep).toMatch(/^\d+:\d{2}$/);
    expect(n.display.inBed).toMatch(/^\d+:\d{2}$/);
    expect(n.stages!.display.deep).toMatch(/^\d+:\d{2}$/);
  });

  it('turns the bedtime into the reader\'s time zone, not UTC', async () => {
    const mine = sleepSeries().find(s => s.key === REF)!;
    const n = nights(await nightsCap().read({ window: { day: REF } }, testCtx()))[0];
    const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(mine.bedtime));
    expect(n.bedtime).toBe(local);
  });
});

describe('nights: in-bed-only records', () => {
  it('carry hasStages false and no asleep value at all, never a zero', async () => {
    const all = nights(await nightsCap().read({ window: { lastDays: 31 }, limit: 31 }, testCtx()));
    const bare = all.filter(n => !n.hasStages);
    expect(bare.length).toBeGreaterThan(0);
    for (const n of bare) {
      expect(n).not.toHaveProperty('asleep');
      expect(n).not.toHaveProperty('stages');
      expect(n.display.asleep).toBeUndefined();
      expect(n.display.inBed).toMatch(/^\d+:\d{2}$/);
    }
    for (const n of all.filter(x => x.hasStages)) expect(n.asleep).toBeGreaterThan(0);
    expect(all.filter(n => !n.hasStages).map(n => n.day).sort()).toEqual(sleepSeries().filter(s => s.key >= addDays(REF, -30) && !hasSleepStages(s)).map(s => s.key).sort());
  });
});

describe('nights: windows and refusals', () => {
  it('takes a day, a month, a start and end, and days as the alias', async () => {
    expect(nights(await nightsCap().read({ window: { day: '2026-09-14' } }, testCtx()))).toHaveLength(1);
    expect(nights(await nightsCap().read({ window: { month: '2026-02' }, limit: 31 }, testCtx()))).toHaveLength(28);
    expect(nights(await nightsCap().read({ window: { start: '2026-09-01', end: '2026-09-07' } }, testCtx()))).toHaveLength(7);
    expect((await nightsCap().read({ days: 3 }, testCtx())).window).toMatchObject({ asked: 'lastDays 3' });
  });

  it('is no_data_in_window before the data, with the coverage and the exact next', async () => {
    const env = await nightsCap().read({ window: { start: '2020-01-01', end: '2020-01-31' } }, testCtx());
    expect(env.status).toBe('no_data_in_window');
    expect(env.coverage).toEqual({ kind: 'known', first: addDays(REF, -(DAYS - 1)), last: REF, count: DAYS, unit: 'nights' });
    expect(env.next).toBe(`No Sleep nights between 2020-01-01 and 2020-01-31. The app holds ${DAYS} nights from ${addDays(REF, -(DAYS - 1))} to ${REF}.`);
  });

  it.each([
    [{ view: 'table' }, /view must be one of: nights, summary/],
    [{ sort: 'dream' }, /sort must be one of: date, asleep, inBed, deep, rem, core, awake, bedtime, wake/],
    [{ order: 'up' }, /order must be one of: desc, asc/],
    [{ limit: 32 }, /limit must be a whole number from 1 to 31/],
    [{ offset: -2 }, /offset must be a whole number/],
    [{ days: 3, window: { lastDays: 2 } }, /either window or days/],
  ])('refuses %j', async (args, problem) => {
    const env = await nightsCap().read(args as Record<string, unknown>, testCtx());
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.join(' ')).toMatch(problem);
  });

  it('is privacy_blocked before any read', async () => {
    const policy: PrivacyPolicy = { allows: () => false };
    const ctx = testCtx({ policy });
    expect((await nightsCap().read({}, ctx)).status).toBe('privacy_blocked');
    expect((await summaryCap().read({}, ctx)).status).toBe('privacy_blocked');
    expect(ctx.access.fetched.citable.size).toBe(0);
  });
});

describe('nights: sorts', () => {
  const sorted = async (sort: string, order: string, extra: Record<string, unknown> = {}) =>
    nights(await nightsCap().read({ window: WIDE, sort, order, limit: 31, ...extra }, testCtx()));

  it('finds the deepest nights, and never ranks an in-bed-only night', async () => {
    const top = await sorted('deep', 'desc', { limit: 10 });
    expect(top).toHaveLength(10);
    expect(top.every(n => n.hasStages)).toBe(true);
    const deeps = top.map(n => n.stages!.deep);
    expect(deeps).toEqual([...deeps].sort((a, b) => b - a));
    expect(deeps[0]).toBe(Math.max(...sleepSeries().filter(hasSleepStages).map(s => s.stages.deep)));
  });

  it('sorts by asleep, inBed, rem, core and awake', async () => {
    const asleep = await sorted('asleep', 'asc');
    expect(asleep[0].asleep).toBe(Math.min(...sleepSeries().filter(hasSleepStages).map(s => s.asleepMinutes)));
    const inBed = await sorted('inBed', 'desc');
    expect(inBed[0].inBed).toBe(Math.max(...sleepSeries().map(s => s.inBedMinutes)));
    for (const key of ['rem', 'core', 'awake'] as const) {
      const r = await sorted(key, 'desc');
      const v = r.map(n => n.stages![key]);
      expect(v).toEqual([...v].sort((a, b) => b - a));
    }
  });

  it('puts nights without the value last, whichever way the sort runs', async () => {
    for (const order of ['asc', 'desc']) {
      const r = await sorted('asleep', order, { window: { lastDays: 31 } });
      const flags = r.map(n => n.hasStages);
      const firstBare = flags.indexOf(false);
      if (firstBare >= 0) expect(flags.slice(firstBare).every(f => !f)).toBe(true);
    }
  });

  it('sorts by bedtime across midnight, latest nights of the evening first when ascending', async () => {
    const r = await sorted('bedtime', 'asc');
    const fmt = (s: string) => {
      const [, h, m, ap] = /(\d+):(\d+) ([AP]M)/.exec(s)!;
      const hh = (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
      return (hh * 60 + Number(m) - 18 * 60 + 1440) % 1440;
    };
    const keys = r.map(n => fmt(n.bedtime));
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it('returns nights, not a summary, whenever a sort is asked for', async () => {
    const env = await nightsCap().read({ window: WIDE, sort: 'deep', limit: 5 }, testCtx());
    expect(nights(env)).toHaveLength(5);
  });
});

describe('nights: paging and size', () => {
  it('pages a year to the end with no night twice', async () => {
    const seen = new Set<string>();
    let offset = 0;
    for (let i = 0; i < 40; i++) {
      const env = await nightsCap().read({ window: WIDE, view: 'nights', limit: 31, offset }, testCtx());
      for (const n of nights(env)) {
        expect(seen.has(n.day)).toBe(false);
        seen.add(n.day);
      }
      if (env.page?.nextOffset === undefined) break;
      offset = env.page.nextOffset;
    }
    expect(seen.size).toBe(DAYS);
  });

  it('keeps a page under 12,000 characters at the default and the maximum limit', async () => {
    expect(sizeOf(await nightsCap().read({}, testCtx()))).toBeLessThanOrEqual(12_000);
    expect(sizeOf(await nightsCap().read({ window: WIDE, view: 'nights', limit: 31 }, testCtx()))).toBeLessThanOrEqual(12_000);
  });

  it('records sleep as citable so a card can cite it', async () => {
    const ctx = testCtx();
    await nightsCap().read({}, ctx);
    expect([...ctx.access.fetched.citable].sort()).toEqual(['sleep_analysis', 'sleep_in_bed']);
    expect(nightsCap().citesAs).toEqual(['sleep_analysis', 'sleep_in_bed']);
  });
});
