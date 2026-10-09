// ── get_sleep: the summary view ─────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSleepStages, resetToDemoDataset, sleepSeries } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { formatDurationHm } from '../../metrics/format';
import { mean } from '../../analytics/stats';
import { capabilityById } from './registry';
import { DAYS, installTestDataset, REF } from './test-dataset.fake';
import { expectClean, sizeOf, testCtx } from './test-context.fake';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

const summary = () => capabilityById('sleep.summary')!;
const nightsCap = () => capabilityById('sleep.nights')!;
type Summary = {
  nights: number;
  stageCoverage: string;
  display: Record<string, string>;
  byPeriod: { period: string; nights: number; display: Record<string, string> }[];
  periodKind: string;
  longest: { day: string; display: Record<string, string> }[];
  shortest: { day: string; display: Record<string, string> }[];
};
const data = (env: { data?: unknown }) => env.data as Summary;
const WIDE = { lastDays: 400 };

describe('sleep summary', () => {
  it('counts nights, says how many carried stages, and averages the staged ones', async () => {
    const env = await summary().read({ window: { lastDays: 30 } }, testCtx());
    expect(env.status).toBe('ok');
    const d = data(env);
    const inWin = sleepSeries().filter(s => s.key >= addDays(REF, -29));
    const staged = inWin.filter(hasSleepStages);
    expect(d.nights).toBe(inWin.length);
    expect(d.stageCoverage).toBe(`${staged.length} of ${inWin.length} nights carry a stage split; the other ${inWin.length - staged.length} record time in bed only and are left out of the time-asleep and stage figures.`);
    expect(d.display.asleep).toBe(formatDurationHm(mean(staged.map(s => s.asleepMinutes))));
    expect(d.display.inBed).toBe(formatDurationHm(mean(inWin.map(s => s.inBedMinutes))));
    expect(d.display.deep).toBe(formatDurationHm(mean(staged.map(s => s.stages.deep))));
    expectClean(env);
  });

  it('lists the three longest and three shortest nights asleep, none of them in-bed-only', async () => {
    const d = data(await summary().read({ window: WIDE }, testCtx()));
    expect(d.longest).toHaveLength(3);
    expect(d.shortest).toHaveLength(3);
    const staged = sleepSeries().filter(hasSleepStages).map(s => s.asleepMinutes);
    expect(d.longest[0].display.asleep).toBe(formatDurationHm(Math.max(...staged)));
    expect(d.shortest[0].display.asleep).toBe(formatDurationHm(Math.min(...staged)));
  });

  it('groups by week up to about a quarter, by month beyond', async () => {
    const short = data(await summary().read({ window: { lastDays: 60 } }, testCtx()));
    expect(short.periodKind).toBe('week');
    expect(short.byPeriod[0].period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const long = data(await summary().read({ window: WIDE }, testCtx()));
    expect(long.periodKind).toBe('month');
    expect(long.byPeriod[0].period).toMatch(/^\d{4}-\d{2}$/);
    expect(long.byPeriod.reduce((n, p) => n + p.nights, 0)).toBe(DAYS);
  });

  it('is the default view for a window holding more than 31 nights, and nights for 31 or fewer', async () => {
    expect((await nightsCap().read({ window: { lastDays: 60 } }, testCtx())).data).toHaveProperty('byPeriod');
    expect((await nightsCap().read({ window: { lastDays: 31 } }, testCtx())).data).toHaveProperty('nights');
    expect((await nightsCap().read({ window: { lastDays: 60 }, view: 'nights' }, testCtx())).data).toHaveProperty('nights');
    expect((await nightsCap().read({ window: { lastDays: 7 }, view: 'summary' }, testCtx())).data).toHaveProperty('byPeriod');
  });

  it('is no_data_in_window for an empty window, and fits well inside the size limit for a year', async () => {
    expect((await summary().read({ window: { start: '2020-01-01', end: '2020-01-31' } }, testCtx())).status).toBe('no_data_in_window');
    expect(sizeOf(await summary().read({ window: WIDE }, testCtx()))).toBeLessThanOrEqual(12_000);
  });

  it('has a coverage that counts every night, in-bed-only ones included', async () => {
    expect(await summary().coverage(testCtx())).toEqual({ kind: 'known', first: addDays(REF, -(DAYS - 1)), last: REF, count: DAYS, unit: 'nights' });
  });
});
