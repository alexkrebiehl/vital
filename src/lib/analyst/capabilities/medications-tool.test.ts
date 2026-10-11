// ── medications.summary and the get_medications tool ────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { runTool } from '../tools';
import { DATA_TOOLS } from '../tools/data';
import { ctxWith, live, summary, TZ } from './medications.fake';
import { expectClean } from './test-context.fake';
import { installTestDataset } from './test-dataset.fake';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

describe('medications.summary', () => {
  it('counts each medication in the window, by the adapter\'s grouping key', async () => {
    const env = await summary({ window: { lastDays: 10 } });
    expect(env.status).toBe('ok');
    const data = env.data as { kind: string; totalRecords: number; totalMedications: number; undatedRecords: number; medications: { medication: string; records: number; taken: number; skipped: number; daysRecorded: number }[] };
    expect(data.kind).toBe('record');
    expect(data.totalMedications).toBe(3);
    expect(data.medications.map(m => m.medication).sort()).toEqual(['Carvedilol', 'Losartan Potassium', 'Vitamin D']);
    const carvedilol = data.medications.find(m => m.medication === 'Carvedilol')!;
    expect(carvedilol).toMatchObject({ records: 10, daysRecorded: 10 });
    expect(carvedilol.taken + carvedilol.skipped).toBeLessThanOrEqual(10);
    expect(data.undatedRecords).toBe(1);
    expectClean(env);
  });

  it('states what it is: a record, not a plan, and not known to be complete, without naming a product', async () => {
    const env = await summary({});
    const text = JSON.stringify(env);
    expect(text).toMatch(/not known to be a complete list/);
    expect(text).not.toMatch(/apple health|health auto export|\bHAE\b/i);
    expect(env.data).toMatchObject({ kind: 'record' });
  });

  it('follows the name filter and the window, and names the window in its note, not "the last N days"', async () => {
    const env = await summary({ window: { month: '2026-09' }, name: 'carvedilol' });
    const data = env.data as { totalMedications: number; note: string };
    expect(data.totalMedications).toBe(1);
    expect(data.note).toContain('2026-09-01');
    expect(data.note).not.toMatch(/last \d+ days/);
  });

  it('records what it fetched, so the answer can cite it', async () => {
    const ctx = live();
    await summary({ days: 14 }, ctx);
    expect(ctx.access.fetched.medications).toMatchObject({ available: true, kind: 'record', lookbackDays: 14 });
    expect(ctx.access.fetched.recordsRead).toBeGreaterThan(0);
    expect(ctx.access.fetched.log.join(' ')).toMatch(/medication/);
  });

  it('answers no_data_in_window for an empty window and source_unavailable for a failed read', async () => {
    expect((await summary({ window: { day: '2026-01-05' }, name: 'carvedilol' })).status).toBe('no_data_in_window');
    const down = ctxWith(async () => {
      throw new Error('timeout');
    });
    expect((await summary({}, down)).status).toBe('source_unavailable');
  });
});

describe('the get_medications tool', () => {
  const tool = DATA_TOOLS.find(t => t.name === 'get_medications')!;
  const call = async (args: Record<string, unknown>, ctx = live()) => {
    const out = await runTool('get_medications', args, { system: 'metric', deps: ctx.routine, changes: [], data: ctx.access });
    return { ...out, json: JSON.parse(out.content) };
  };

  // The sentences of today's description that say what the log is and that forbid advice.
  const RECORD_NOT_PLAN = 'It is a RECORD of what was logged, not a treatment plan and not known to be complete.';
  const NO_ADVICE = 'Never advise on starting, stopping or changing a dose from it.';

  it('keeps the record-not-plan and no-advice sentences word for word', () => {
    expect(tool.description).toContain(RECORD_NOT_PLAN);
    expect(tool.description).toContain(NO_ADVICE);
    expect(tool.description.endsWith(NO_ADVICE)).toBe(true);
  });

  it('describes the doses view and the window without naming a product', () => {
    expect(tool.description).toMatch(/doses/);
    expect(tool.description).toMatch(/window/);
    expect(tool.description).not.toMatch(/apple health|health auto export|\bHAE\b/i);
  });

  it('shows the summary by default, as the old call (days only) did, and the doses under view: doses', async () => {
    const a = await call({ days: 14 });
    expect(a.isError).toBe(false);
    expect(a.json.data).toMatchObject({ kind: 'record', lookbackDays: 14 });
    expect(a.json.data.medications).toBeDefined();
    const b = await call({ view: 'doses', window: { lastDays: 7 } });
    expect(b.json.data.doses).toHaveLength(14);
  });

  it('marks a failed read as an error and a no-data window as an answer', async () => {
    const down = ctxWith(async () => ({ available: false, reason: 'The medication source is not configured.', timezone: TZ, records: [] }));
    const bad = await call({}, down);
    expect(bad.isError).toBe(true);
    expect(bad.json.status).toBe('source_unavailable');
    const empty = await call({ window: { day: '2026-01-05' } });
    expect(empty.isError).toBe(false);
    expect(empty.json.status).toBe('no_data_in_window');
  });

  it('rejects arguments outside its schema', async () => {
    expect((await call({ view: 'plan' })).isError).toBe(true);
    expect((await call({ days: 0 })).isError).toBe(true);
    expect((await call({ nope: 1 })).isError).toBe(true);
  });
});
