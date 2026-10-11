// ── get_blood_pressure: readings and their summary ─────────────────────────
//
// 60 synthetic readings over the last 120 days (every second day from REF-119). The
// fifth reading has lost its systolic half: a reading is a pair, so it is dropped,
// never shown as half a pair.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bloodPressureSeries, resetToDemoDataset } from '../../adapters/dataset';
import { BP_REFERENCE_THRESHOLD, isAboveBloodPressureReference } from '../../analytics/bloodPressure';
import { addDays } from '../../analytics/windows';
import { capabilityById } from './registry';
import { installTestDataset, REF } from './test-dataset.fake';
import { expectClean, sizeOf, testCtx } from './test-context.fake';
import type { PrivacyPolicy } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

const bp = () => capabilityById('heart.blood_pressure')!;
type Reading = { day: string; systolic: number; diastolic: number; display: string; aboveReference: boolean };
const readings = (env: { data?: unknown }) => (env.data as { readings: Reading[] }).readings;
const WIDE = { lastDays: 200 };
const complete = () => bloodPressureSeries();

describe('readings', () => {
  it('lists the last 30 days as pairs with a display string and the reference flag', async () => {
    const env = await bp().read({}, testCtx());
    expect(env.status).toBe('ok');
    expect(env.window).toEqual({ start: addDays(REF, -29), end: REF, asked: 'lastDays 30 (default)' });
    const r = readings(env);
    expect(r.length).toBe(complete().filter(x => x.date >= addDays(REF, -29)).length);
    for (const x of r) {
      expect(x.display).toBe(`${x.systolic}/${x.diastolic} mmHg`);
      expect(x.aboveReference).toBe(isAboveBloodPressureReference(x));
    }
    expect(r.map(x => x.day)).toEqual([...r.map(x => x.day)].sort().reverse());
    expectClean(env);
  });

  it('drops the reading that lost a half, and counts only whole pairs', async () => {
    const all = readings(await bp().read({ window: WIDE, limit: 100 }, testCtx()));
    expect(all).toHaveLength(59);
    expect(all.every(x => Number.isFinite(x.systolic) && Number.isFinite(x.diastolic))).toBe(true);
  });

  it('filters to the readings above the reference threshold', async () => {
    const env = await bp().read({ window: WIDE, aboveReferenceOnly: true, limit: 100 }, testCtx());
    const r = readings(env);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(x => x.systolic > BP_REFERENCE_THRESHOLD.systolic || x.diastolic > BP_REFERENCE_THRESHOLD.diastolic)).toBe(true);
    expect(r.length).toBe(complete().filter(isAboveBloodPressureReference).length);
    expect(env.page?.total).toBe(r.length);
  });

  it('pages to the end with nothing twice, 50 to a page by default', async () => {
    const seen: string[] = [];
    let offset = 0;
    let first = true;
    for (let i = 0; i < 10; i++) {
      const env = await bp().read({ window: WIDE, offset }, testCtx());
      if (first) expect(readings(env)).toHaveLength(50);
      first = false;
      seen.push(...readings(env).map((x, k) => `${offset + k}:${x.day}`));
      if (env.page?.nextOffset === undefined) break;
      offset = env.page.nextOffset;
    }
    expect(seen).toHaveLength(59);
    expect(new Set(seen).size).toBe(59);
  });
});

describe('windows and refusals', () => {
  it('takes a day, a month, a start and end, and days as the alias', async () => {
    expect((await bp().read({ window: { start: '2026-09-01', end: '2026-09-30' } }, testCtx())).window).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
    expect((await bp().read({ window: { month: '2026-08' } }, testCtx())).window).toMatchObject({ start: '2026-08-01', end: '2026-08-31' });
    expect((await bp().read({ days: 10 }, testCtx())).window).toMatchObject({ asked: 'lastDays 10' });
    expect((await bp().read({ window: { day: addDays(REF, -119) } }, testCtx())).status).toBe('ok');
  });

  it('is no_data_in_window before the readings, with the coverage and the exact next', async () => {
    const env = await bp().read({ window: { start: '2026-01-01', end: '2026-01-31' } }, testCtx());
    expect(env.status).toBe('no_data_in_window');
    const first = complete()[0].date;
    const last = complete()[complete().length - 1].date;
    expect(env.coverage).toEqual({ kind: 'known', first, last, count: 59, unit: 'readings' });
    expect(env.next).toBe(`No Blood pressure between 2026-01-01 and 2026-01-31. The app holds 59 readings from ${first} to ${last}.`);
  });

  it.each([
    [{ view: 'chart' }, /view must be one of: readings, summary/],
    [{ aboveReferenceOnly: 'yes' }, /aboveReferenceOnly must be true or false/],
    [{ limit: 101 }, /limit must be a whole number from 1 to 100/],
    [{ offset: 1.5 }, /offset must be a whole number/],
    [{ days: 3, window: { day: REF } }, /either window or days/],
  ])('refuses %j', async (args, problem) => {
    const env = await bp().read(args as Record<string, unknown>, testCtx());
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.join(' ')).toMatch(problem);
  });

  it('is privacy_blocked before reading', async () => {
    const policy: PrivacyPolicy = { allows: () => false };
    const ctx = testCtx({ policy });
    expect((await bp().read({}, ctx)).status).toBe('privacy_blocked');
    expect(ctx.access.fetched.citable.size).toBe(0);
  });
});

describe('summary', () => {
  type Summary = { count: number; referenceThreshold: string; display: Record<string, string>; aboveReference: { count: number; share: string }; baseline: Record<string, string>; change?: Record<string, string>; note: string };
  const summary = async (args: Record<string, unknown> = {}) => bp().read({ view: 'summary', ...args }, testCtx());
  const sum = (env: { data?: unknown }) => env.data as Summary;

  it('states the mean, median and range as pairs, labelled a reference threshold', async () => {
    const env = await summary({ window: WIDE });
    const d = sum(env);
    expect(d.count).toBe(59);
    expect(d.referenceThreshold).toBe('120/80 mmHg');
    for (const k of ['mean', 'median', 'lowest', 'highest']) expect(d.display[k]).toMatch(/^\d+\/\d+ mmHg$/);
    expect(d.aboveReference.count).toBe(complete().filter(isAboveBloodPressureReference).length);
    expect(d.aboveReference.share).toMatch(/^\d+%$/);
    expect(d.baseline.mean).toMatch(/mmHg$/);
    expect(d.note).toMatch(/reference threshold/);
    expect(JSON.stringify(env)).not.toMatch(/hypertens|high blood pressure|diagnosed/i);
    expectClean(env);
  });

  it('compares with the equal window before when both hold readings', async () => {
    const d = sum(await summary({ window: { lastDays: 40 } }));
    expect(d.change?.delta).toMatch(/^[+-]?\d+\/[+-]?\d+ mmHg$|no change/);
    expect(d.change?.against).toMatch(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  });

  it('has no change when the earlier window is empty', async () => {
    const d = sum(await summary({ window: { lastDays: 120 } }));
    expect(d.change).toBeUndefined();
  });

  it('honours aboveReferenceOnly in the summary', async () => {
    const d = sum(await summary({ window: WIDE, aboveReferenceOnly: true }));
    expect(d.aboveReference.share).toBe('100%');
  });

  it('is small, and records blood pressure as citable', async () => {
    const ctx = testCtx();
    const env = await bp().read({ view: 'summary', window: WIDE }, ctx);
    expect(sizeOf(env)).toBeLessThan(2_000);
    expect([...ctx.access.fetched.citable]).toEqual(['blood_pressure']);
    expect(bp().citesAs).toEqual(['blood_pressure']);
  });

  it('keeps 100 readings under 12,000 characters', async () => {
    expect(sizeOf(await bp().read({ window: WIDE, limit: 100 }, testCtx()))).toBeLessThanOrEqual(12_000);
  });
});
