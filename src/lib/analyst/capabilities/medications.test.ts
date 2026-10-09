// ── medications.doses: the dose rows over any window ────────────────────────
//
// Synthetic, seeded records through the injected medication reader: nothing here
// reads the health source, the database or a model.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { ctxWith, doses, live, TZ } from './medications.fake';
import { expectClean, sizeOf } from './test-context.fake';
import { installTestDataset, REF } from './test-dataset.fake';

type Dose = { day: string; time: string; medication: string; status: string; dose?: string };
const rowsOf = (env: Awaited<ReturnType<typeof doses>>) => (env.data as { doses: Dose[] }).doses;

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

describe('medications.doses', () => {
  it('lists the last 30 days by default, newest first, one row per dose', async () => {
    const env = await doses({});
    expect(env.status).toBe('ok');
    expect(env.window).toMatchObject({ start: addDays(REF, -29), end: REF, asked: 'lastDays 30 (default)' });
    expect(env.page).toMatchObject({ returned: 60, total: 60 });
    const rows = rowsOf(env);
    expect(rows[0]).toMatchObject({ day: REF, medication: expect.any(String), status: expect.stringMatching(/^(taken|skipped|unknown)$/) });
    expect(rows.every((r, i) => i === 0 || rows[i - 1].day >= r.day)).toBe(true);
    expectClean(env);
  });

  it('gives the local clock time of a dose in the zone the day was cut in', async () => {
    const env = await doses({ window: { day: REF }, name: 'carvedilol' });
    expect(rowsOf(env)).toEqual([{ day: REF, time: '8:00 AM', medication: 'Carvedilol', status: 'taken', dose: 'Carvedilol 6.25mg Oral tablet' }]);
  });

  it('accepts every window form', async () => {
    expect((await doses({ window: { day: addDays(REF, -3) } })).page?.total).toBe(2);
    expect((await doses({ window: { start: addDays(REF, -9), end: addDays(REF, -5) } })).page?.total).toBe(10);
    expect((await doses({ window: { lastDays: 7 } })).page?.total).toBe(14);
    const month = await doses({ window: { month: '2026-09' } });
    expect(month.window).toMatchObject({ start: '2026-09-01', end: '2026-09-30', asked: 'month 2026-09' });
    expect(month.page?.total).toBe(60);
  });

  it('reads further back than the old 90 day cap, and keeps days as the alias of lastDays', async () => {
    const older = await doses({ window: { start: '2026-08-10', end: '2026-08-20' } });
    expect(older.status).toBe('ok');
    const aliased = await doses({ days: 5 });
    expect(aliased.window).toMatchObject({ start: addDays(REF, -4), end: REF, asked: 'lastDays 5' });
    expect(aliased.page?.total).toBe(10);
  });

  it('refuses days together with window, a bad window, and a future one', async () => {
    expect((await doses({ days: 5, window: { lastDays: 5 } })).status).toBe('invalid_args');
    expect((await doses({ window: { month: '2026-13' } })).status).toBe('invalid_args');
    const future = await doses({ window: { day: addDays(REF, 2) } });
    expect(future.status).toBe('invalid_args');
    expect(future.problems?.join(' ')).toMatch(/after today/);
  });

  it('pages the doses and says how to read on', async () => {
    const first = await doses({ limit: 25 });
    expect(rowsOf(first)).toHaveLength(25);
    expect(first.page).toMatchObject({ returned: 25, total: 60, offset: 0, nextOffset: 25 });
    expect(first.page?.how).toBe('25 of 60 shown. Call again with offset 25 for more, or use view: summary.');
    const last = await doses({ limit: 25, offset: 50 });
    expect(rowsOf(last)).toHaveLength(10);
    expect(last.page?.nextOffset).toBeUndefined();
    expect((await doses({ limit: 101 })).status).toBe('invalid_args');
  });

  it('keeps a default page under the size the other record tools respect', async () => {
    expect(sizeOf(await doses({}))).toBeLessThanOrEqual(12_000);
    expect(sizeOf(await doses({ limit: 100, window: { lastDays: 90 } }))).toBeLessThanOrEqual(12_000);
  });

  it('filters by name in any letter case', async () => {
    const env = await doses({ name: 'LoSaRtAn' });
    expect(env.page?.total).toBe(30);
    expect(new Set(rowsOf(env).map(r => r.medication))).toEqual(new Set(['Losartan Potassium']));
  });

  it('counts a record with no scheduled date but puts it on no day', async () => {
    const withDoses = await doses({ window: { day: REF } });
    expect(withDoses.data).toMatchObject({ undatedRecords: 1 });
    expect(rowsOf(withDoses).map(r => r.medication)).not.toContain('Vitamin D');
    expect(JSON.stringify(withDoses.data)).toMatch(/belong to no day/);
    // Only an undated record matches: the window is still empty, and says what it left out.
    const onlyUndated = await doses({ name: 'vitamin' });
    expect(onlyUndated.status).toBe('no_data_in_window');
    expect(onlyUndated.data).toMatchObject({ undatedRecords: 1 });
  });

  it('answers no_data_in_window for a window with no dose, with the window echoed', async () => {
    const env = await doses({ window: { day: '2026-01-05' } });
    expect(env.status).toBe('no_data_in_window');
    expect(env.window).toMatchObject({ start: '2026-01-05', end: '2026-01-05' });
    expect(env.next).toMatch(/^No Medication doses between 2026-01-05 and 2026-01-05\./);
  });

  it('reports a read that threw as source_unavailable with the reason scrubbed, never as none', async () => {
    const ctx = ctxWith(async () => {
      throw new Error('boom https://user:hunter2pass@meds.example.com/api/medications?x=1');
    });
    const env = await doses({}, ctx);
    expect(env.status).toBe('source_unavailable');
    expect(env.next).toMatch(/could not be read: .*This says nothing about whether records exist\.$/);
    expect(JSON.stringify(env)).not.toMatch(/hunter2pass|meds\.example\.com|https?:\/\//);
  });

  it('reports a source that says it is unavailable the same way', async () => {
    const ctx = ctxWith(async () => ({ available: false, reason: 'The medication source is not configured.', timezone: TZ, records: [] }));
    const env = await doses({}, ctx);
    expect(env.status).toBe('source_unavailable');
    expect(env.next).toContain('The medication source is not configured.');
    expect(env.data).toBeUndefined();
  });

  it('withholds the doses when the privacy policy does', async () => {
    const env = await doses({}, { ...live(), policy: { allows: () => false } });
    expect(env.status).toBe('privacy_blocked');
  });
});

