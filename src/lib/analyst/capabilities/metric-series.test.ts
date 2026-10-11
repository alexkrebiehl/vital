// ── get_metric_series: any registered metric, any window ──────────────────
//
// Synthetic data only. 400 days ending 2026-10-08; step_count's last day is partial.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { capabilityById } from './registry';
import { installTestDataset, REF } from './test-dataset.fake';
import { expectClean, sizeOf, testCtx } from './test-context.fake';
import type { PrivacyPolicy } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

const series = () => capabilityById('metrics.series')!;
const run = (args: Record<string, unknown>, ctx = testCtx()) => series().read(args, ctx);
type Metric = { metricId: string; points?: { key: string; value: number; display: string }[]; summary: Record<string, string>; observations: number; granularity: string; window: { start: string; end: string }; change?: Record<string, string>; compareWindow?: { start: string; end: string }; page?: { nextOffset?: number; total: number; returned: number }; note?: string };
const metrics = (env: { data?: unknown }) => (env.data as { metrics: Metric[] }).metrics;

describe('defaults', () => {
  it('returns the last 30 days by day, compared with the 30 before', async () => {
    const env = await run({ metrics: ['resting_heart_rate'] });
    expect(env.status).toBe('ok');
    expect(env.capability).toBe('metrics.series');
    expect(env.window).toEqual({ start: addDays(REF, -29), end: REF, asked: 'lastDays 30 (default)' });
    const [m] = metrics(env);
    expect(m.granularity).toBe('day');
    expect(m.observations).toBe(30);
    expect(m.points).toHaveLength(30);
    expect(m.points![29]).toMatchObject({ key: REF });
    expect(m.points![29].display).toMatch(/bpm/);
    expect(Object.keys(m.summary).sort()).toEqual(['latest', 'latestOn', 'max', 'mean', 'median', 'min']);
    expect(m.summary.latestOn).toBe(REF);
    expect(m.change).toBeDefined();
    expect(m.compareWindow).toEqual({ start: addDays(REF, -59), end: addDays(REF, -30) });
    expectClean(env);
  });

  it('records the summary it built so the answer can cite the metric', async () => {
    const ctx = testCtx();
    await run({ metrics: ['resting_heart_rate'] }, ctx);
    expect(ctx.access.fetched.summaries.map(s => s.metricId)).toEqual(['resting_heart_rate']);
  });

  it('records a metric as citable when the window is not one a summary exists for', async () => {
    const ctx = testCtx();
    await run({ metrics: ['heart_rate_variability'], window: { month: '2026-03' } }, ctx);
    expect(ctx.access.fetched.citable.has('heart_rate_variability')).toBe(true);
  });

  it('resolves a display name and an alias to the registry id', async () => {
    const env = await run({ metrics: ['Resting Heart Rate'] });
    expect(metrics(env)[0].metricId).toBe('resting_heart_rate');
  });
});

describe('windows', () => {
  it('takes a single day', async () => {
    const env = await run({ metrics: ['resting_heart_rate'], window: { day: '2026-09-14' } });
    const [m] = metrics(env);
    expect(env.window).toMatchObject({ start: '2026-09-14', end: '2026-09-14', asked: 'day 2026-09-14' });
    expect(m.points).toHaveLength(1);
    expect(m.observations).toBe(1);
  });

  it('takes a month, a start and end, and lastDays', async () => {
    expect(metrics(await run({ metrics: ['resting_heart_rate'], window: { month: '2026-03' } }))[0].observations).toBe(31);
    expect(metrics(await run({ metrics: ['resting_heart_rate'], window: { start: '2026-09-01', end: '2026-09-10' } }))[0].observations).toBe(10);
    expect(metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 7 } }))[0].observations).toBe(7);
  });

  it('keeps days as the alias of lastDays', async () => {
    const env = await run({ metrics: ['resting_heart_rate'], days: 7 });
    expect(env.window).toMatchObject({ start: addDays(REF, -6), end: REF, asked: 'lastDays 7' });
  });

  it('refuses both a window and days', async () => {
    const env = await run({ metrics: ['resting_heart_rate'], days: 7, window: { lastDays: 3 } });
    expect(env.status).toBe('invalid_args');
  });

  it('clips a window that runs past today and says so', async () => {
    const env = await run({ metrics: ['resting_heart_rate'], window: { start: '2026-10-01', end: '2026-10-30' } });
    expect(env.window).toMatchObject({ start: '2026-10-01', end: REF });
    expect(env.window?.clipped).toMatch(/clipped to today/);
  });

  it('refuses a window after today and an impossible date, with problems', async () => {
    const future = await run({ metrics: ['resting_heart_rate'], window: { day: '2026-11-01' } });
    expect(future.status).toBe('invalid_args');
    expect(future.problems?.[0]).toMatch(/after today/);
    const bad = await run({ metrics: ['resting_heart_rate'], window: { day: '2026-02-30' } });
    expect(bad.problems?.[0]).toMatch(/not a real calendar day/);
  });
});

describe('granularity', () => {
  it('goes from days to weeks to months as the window grows', async () => {
    expect(metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 92 } }))[0].granularity).toBe('day');
    const weeks = metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 200 } }))[0];
    expect(weeks.granularity).toBe('week');
    expect(weeks.points!.length).toBeGreaterThan(25);
    expect(weeks.points!.length).toBeLessThan(35);
    const months = metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 730 } }))[0];
    expect(months.granularity).toBe('month');
    expect(months.points![0].key).toMatch(/^\d{4}-\d{2}$/);
  });

  it('honours an explicit granularity, and summary sends no points', async () => {
    expect(metrics(await run({ metrics: ['resting_heart_rate'], granularity: 'month' }))[0].granularity).toBe('month');
    const sum = metrics(await run({ metrics: ['resting_heart_rate'], granularity: 'summary' }))[0];
    expect(sum.points).toBeUndefined();
    expect(sum.summary.mean).toMatch(/bpm/);
  });

  it('labels an aggregated point by the mean of its days', async () => {
    const w = metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 200 } }))[0];
    expect(w.note).toMatch(/mean of the daily values/);
  });
});

describe('comparison', () => {
  it('can be switched off', async () => {
    const m = metrics(await run({ metrics: ['resting_heart_rate'], compareTo: 'none' }))[0];
    expect(m.change).toBeUndefined();
    expect(m.compareWindow).toBeUndefined();
  });

  it('can name the window to compare against', async () => {
    const m = metrics(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 7 }, compareTo: { start: '2026-08-01', end: '2026-08-07' } }))[0];
    expect(m.compareWindow).toEqual({ start: '2026-08-01', end: '2026-08-07' });
    expect(m.change!.delta).toBeTruthy();
  });

  it('refuses a compareTo it cannot read', async () => {
    expect((await run({ metrics: ['resting_heart_rate'], compareTo: 'sometimes' })).status).toBe('invalid_args');
    expect((await run({ metrics: ['resting_heart_rate'], compareTo: { start: '2026-08-09', end: '2026-08-01' } })).status).toBe('invalid_args');
  });
});

describe('an accumulating metric', () => {
  it('drops the day still in progress (the rule compare_periods had)', async () => {
    const env = await run({ metrics: ['step_count'] });
    const [m] = metrics(env);
    expect(m.points!.some(p => p.key === REF)).toBe(false);
    expect(m.observations).toBe(29);
    expect(m.note).toMatch(/in progress/);
    expectClean(env);
  });

  it('keeps every day of a window that ended before today', async () => {
    const m = metrics(await run({ metrics: ['step_count'], window: { start: '2026-09-01', end: '2026-09-30' } }))[0];
    expect(m.observations).toBe(30);
  });
});

describe('refusals', () => {
  it('sends blood pressure to get_blood_pressure', async () => {
    const env = await run({ metrics: ['blood_pressure'] });
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.join(' ')).toMatch(/get_blood_pressure/);
  });

  it('names an unknown metric with didYouMean', async () => {
    const env = await run({ metrics: ['heart stuff'] });
    expect(env.status).toBe('invalid_args');
    expect((env.data as { didYouMean: string[] }).didYouMean).toContain('resting_heart_rate');
  });

  it('refuses none and more than three metrics', async () => {
    expect((await run({ metrics: [] })).status).toBe('invalid_args');
    expect((await run({ metrics: ['step_count', 'active_energy', 'resting_heart_rate', 'heart_rate_variability'] })).status).toBe('invalid_args');
  });

  it('answers privacy_blocked before reading', async () => {
    const policy: PrivacyPolicy = { allows: () => false };
    const ctx = testCtx({ policy });
    expect((await run({ metrics: ['resting_heart_rate'] }, ctx)).status).toBe('privacy_blocked');
    expect(ctx.access.fetched.summaries).toEqual([]);
  });
});

describe('a window with nothing in it', () => {
  it('is no_data_in_window with the coverage and the exact next', async () => {
    const env = await run({ metrics: ['resting_heart_rate'], window: { start: '2020-01-01', end: '2020-01-31' } });
    expect(env.status).toBe('no_data_in_window');
    expect(env.coverage).toEqual({ kind: 'known', first: addDays(REF, -399), last: REF, count: 400, unit: 'days of resting heart rate' });
    expect(env.next).toBe(`No Metric series between 2020-01-01 and 2020-01-31. The app holds 400 days of resting heart rate from ${addDays(REF, -399)} to ${REF}.`);
  });

  it('reports a registered metric the dataset has no values for as noData, not an error', async () => {
    const env = await run({ metrics: ['resting_heart_rate', 'vo2max'] });
    expect(env.status).toBe('ok');
    expect((env.data as { noData: { metric: string }[] }).noData[0].metric).toBe('vo2max');
  });
});

describe('size', () => {
  it('keeps three metrics of 92 days under 12,000 characters, paging the rest', async () => {
    const env = await run({ metrics: ['resting_heart_rate', 'heart_rate_variability', 'active_energy'], window: { lastDays: 92 } });
    expect(sizeOf(env)).toBeLessThanOrEqual(12_000);
    const ms = metrics(env);
    expect(ms.some(m => m.page?.nextOffset !== undefined)).toBe(true);
    expect(ms[0].page!.total).toBe(92);
    expectClean(env);
  });

  it('pages on with offset until the series ends, with no day twice', async () => {
    const args = { metrics: ['resting_heart_rate', 'heart_rate_variability', 'active_energy'], window: { lastDays: 92 } };
    const seen = new Set<string>();
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const m = metrics(await run({ ...args, offset }))[0];
      for (const p of m.points ?? []) {
        expect(seen.has(p.key)).toBe(false);
        seen.add(p.key);
      }
      if (m.page?.nextOffset === undefined) break;
      offset = m.page.nextOffset;
    }
    expect(seen.size).toBe(92);
  });

  it('keeps one metric of 92 days inside the limit by default', async () => {
    expect(sizeOf(await run({ metrics: ['resting_heart_rate'], window: { lastDays: 92 } }))).toBeLessThanOrEqual(12_000);
  });
});
