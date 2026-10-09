// ── get_app_data: insights and reports ──────────────────────────────────────
//
// The generated insights and the weekly and monthly reports, projected to text.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { appCtx, healthyReaders, installBodyDataset } from './app.fake';
import { isErrorStatus, type Envelope } from './envelope';
import { assertNumberRule } from './number-rule';
import { capabilityById } from './registry';
import { expectClean, sizeOf } from './test-context.fake';
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

describe('insights.current', () => {
  it('gives each insight as text, with its evidence as display strings and no chart points', async () => {
    const env = await read('insights.current');
    expectClean(env);
    const items = data(env).insights as Record<string, any>[];
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i).toMatchObject({ title: expect.any(String), summary: expect.any(String), caveat: expect.any(String) });
      expect(i).not.toHaveProperty('points');
      expect(i.evidence.every((e: unknown) => typeof e === 'string')).toBe(true);
    }
    expect(sizeOf(env)).toBeLessThanOrEqual(12_000);
  });

  it('says plainly when no insight meets the evidence thresholds', async () => {
    const env = await read('insights.current', {}, appCtx(healthyReaders(), { refKey: '2019-01-01' }));
    expect(env.status).toBe('no_data_in_window');
    expect(env.next).toMatch(/No insight/);
  });
});

describe('insights.reports', () => {
  it('builds the weekly reports, most recent first', async () => {
    const env = await read('insights.reports', { kind: 'weekly', count: 3 });
    expectClean(env);
    const reports = data(env).reports as Record<string, any>[];
    expect(reports).toHaveLength(3);
    expect(reports[0].window.end).toBe(addDays(REF, -1));
    expect(reports[0].window.start).toBe(addDays(REF, -7));
    expect(reports[0].lines[0]).toMatchObject({ metric: expect.any(String), value: expect.any(String), change: expect.any(String) });
    expect(reports[0].lines[0]).not.toHaveProperty('deltaPercent');
  });

  it('builds the monthly reports', async () => {
    const env = await read('insights.reports', { kind: 'monthly', count: 2 });
    expect(env.status).toBe('ok');
    expect(data(env).reports).toHaveLength(2);
    assertNumberRule(env);
  });

  it('pages twelve weekly reports, each whole, inside the result size', async () => {
    const first = await read('insights.reports', { kind: 'weekly', count: 12 });
    expect(sizeOf(first)).toBeLessThanOrEqual(12_000);
    const shown = (data(first).reports as unknown[]).length;
    expect(first.page).toMatchObject({ returned: shown, total: 12, offset: 0, nextOffset: shown });
    const rest = await read('insights.reports', { kind: 'weekly', count: 12, offset: shown });
    expect(data(rest).reports[0].title).not.toBe(data(first).reports[0].title);
    expect(rest.page).toMatchObject({ offset: shown });
  });

  it.each([[{}], [{ kind: 'yearly' }], [{ kind: 'weekly', count: 13 }], [{ kind: 'weekly', count: 0 }]])('refuses %j', async args => {
    const env = await read('insights.reports', args);
    expect(env.status).toBe('invalid_args');
    expect(isErrorStatus(env.status)).toBe(true);
  });

  it('says so when no complete period is covered', async () => {
    const env = await read('insights.reports', { kind: 'weekly' }, appCtx(healthyReaders(), { refKey: '2019-01-01' }));
    expect(env.status).toBe('no_data_in_window');
  });
});

