// ── get_app_data: the body goal and nutrition adherence ─────────────────────
//
// The goal summary as display strings, and each logged day against the targets as
// the Nutrition page judges it, for any window.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { appCtx, healthyReaders, installBodyDataset } from './app.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import { expectClean } from './test-context.fake';
import { REF } from './test-dataset.fake';
import type { CapabilityContext } from './types';

beforeEach(() => void installBodyDataset());
afterEach(() => resetToDemoDataset());

const read = (id: string, args: Record<string, unknown> = {}, ctx: CapabilityContext = appCtx()): Promise<Envelope<unknown>> => {
  const cap = capabilityById(id);
  if (!cap) throw new Error(`no capability ${id}`);
  return cap.read(args, ctx);
};
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;

describe('body.goal', () => {
  it('gives the goal summary as display strings, in the reader\'s units', async () => {
    const env = await read('body.goal');
    expectClean(env);
    const goal = data(env);
    expect(goal.goal).toBe('Reach 78 kg body weight');
    expect(goal.current.weight).toMatch(/^\d+(\.\d)? kg$/);
    expect(goal.foodLog.loggedDays).toMatch(/logged day/);
    expect(JSON.stringify(env)).not.toContain('null');
    const imperial = await read('body.goal', {}, appCtx(healthyReaders(), { system: 'imperial' }));
    expect(data(imperial).current.weight).toMatch(/ lb$/);
  });

  it('says "No body goal is set." when there is none', async () => {
    const env = await read('body.goal', {}, appCtx(healthyReaders({ goalSummary: async () => null })));
    expect(env).toMatchObject({ status: 'no_data_in_window', next: 'No body goal is set.' });
  });

  it('is unavailable when the store is not configured or cannot be read', async () => {
    const off = await read('body.goal', {}, appCtx(healthyReaders({ databaseConfigured: () => false })));
    expect(off.status).toBe('source_unavailable');
    const down = await read('body.goal', {}, appCtx(healthyReaders({ goalSummary: async () => { throw new Error('the goals could not be read'); } })));
    expect(down.status).toBe('source_unavailable');
    expect(down.next).not.toMatch(/No body goal/);
  });
});

describe('body.nutrition_adherence', () => {
  const rows = (env: Envelope<unknown>) => data(env).days as Record<string, any>[];

  it('judges each logged day against the targets as the Nutrition page does, ending yesterday', async () => {
    const env = await read('body.nutrition_adherence');
    expectClean(env);
    expect(env.window).toMatchObject({ end: addDays(REF, -1), start: addDays(REF, -28) });
    expect(env.window?.clipped).toMatch(/still being logged/);
    const days = rows(env);
    expect(days.length).toBeGreaterThan(5);
    expect(days.every(d => d.day >= env.window!.start && d.day <= env.window!.end)).toBe(true);
    const complete = days.filter(d => d.log === 'complete');
    expect(complete.length).toBeGreaterThan(3);
    for (const d of complete) {
      expect(d.calories).toMatch(/^[\d,]+ kcal$/);
      expect(d.caloriesVerdict).toMatch(/on target|OK, close to the target|above the OK range|below the OK range/);
    }
    expect(data(env).targets.calories).toMatch(/kcal a day$/);
    expect(data(env).summary.calories).toMatch(/of \d+ logged days within the OK range/);
  });

  it('marks a partly logged day and leaves it unjudged; unlogged days are not rows and never zero', async () => {
    const env = await read('body.nutrition_adherence', { window: { lastDays: 28 } });
    const partial = rows(env).find(d => d.day === addDays(REF, -3));
    expect(partial).toMatchObject({ log: 'partial', calories: '400 kcal' });
    expect(partial).not.toHaveProperty('caloriesVerdict');
    expect(rows(env).some(d => d.log === 'none')).toBe(false);
    expect(JSON.stringify(env)).not.toMatch(/"(calories|protein)":"0 (kcal|g)"/);
  });

  it('takes any window and echoes it', async () => {
    const env = await read('body.nutrition_adherence', { window: { start: addDays(REF, -20), end: addDays(REF, -10) } });
    expect(env.status).toBe('ok');
    expect(env.window).toMatchObject({ start: addDays(REF, -20), end: addDays(REF, -10), asked: `start ${addDays(REF, -20)}, end ${addDays(REF, -10)}` });
    expect(env.window?.clipped).toBeUndefined();
  });

  it('pages the days', async () => {
    const env = await read('body.nutrition_adherence', { limit: 4 });
    expect(rows(env)).toHaveLength(4);
    expect(env.page).toMatchObject({ returned: 4, offset: 0, nextOffset: 4 });
    const next = await read('body.nutrition_adherence', { limit: 4, offset: 4 });
    expect(rows(next)[0].day).not.toBe(rows(env)[0].day);
  });

  it('answers a window with no food log as an empty window with the log\'s span', async () => {
    const env = await read('body.nutrition_adherence', { window: { start: '2026-06-01', end: '2026-06-30' } });
    expect(env.status).toBe('no_data_in_window');
    expect(env.coverage).toMatchObject({ kind: 'known', unit: 'logged days' });
    expect(env.next).toMatch(/The app holds \d+ logged days from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  });

  it('says so when there is no goal, or the goal has no targets yet', async () => {
    const none = await read('body.nutrition_adherence', {}, appCtx(healthyReaders({ goalReport: async () => null })));
    expect(none).toMatchObject({ status: 'no_data_in_window', next: 'No body goal is set.' });
    const report = await healthyReaders().goalReport!('metric', {} as NodeJS.ProcessEnv);
    const bare = await read('body.nutrition_adherence', {}, appCtx(healthyReaders({ goalReport: async () => ({ ...report!, targets: null }) })));
    expect(bare.status).toBe('no_data_in_window');
    expect(bare.next).toMatch(/no nutrition targets/);
  });

  it('refuses a bad window, and is unavailable without a store', async () => {
    expect((await read('body.nutrition_adherence', { window: { month: '2026-13' } })).status).toBe('invalid_args');
    expect((await read('body.nutrition_adherence', { limit: 500 })).status).toBe('invalid_args');
    const off = await read('body.nutrition_adherence', {}, appCtx(healthyReaders({ databaseConfigured: () => false })));
    expect(off.status).toBe('source_unavailable');
  });
});

