// ── get_app_data: the tool ──────────────────────────────────────────────────
//
// The dispatch: a capability from the registry's enum, its params checked against
// its own schema, an unknown name answered with the list, errors only where the
// design says they are.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { createDataAccess } from '../dataAccess';
import { runTool } from '../tools';
import { healthyReaders, installBodyDataset } from './app.fake';
import { DEMO } from './test-context.fake';
import { REF } from './test-dataset.fake';

beforeEach(() => void installBodyDataset());
afterEach(() => resetToDemoDataset());

describe('get_app_data, the tool', () => {
  const toolCtx = (readers = healthyReaders()) => ({
    system: 'metric' as const,
    deps: { env: DEMO },
    changes: [],
    data: createDataAccess({ system: 'metric', refKey: REF, env: DEMO, app: readers }),
  });
  const call = async (args: Record<string, unknown>, ctx = toolCtx()) => {
    const r = await runTool('get_app_data', args, ctx);
    return { ...r, json: JSON.parse(r.content) };
  };

  it('reads the capability it is given, through the same read', async () => {
    const r = await call({ capability: 'body.goal' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ status: 'ok', capability: 'body.goal' });
  });

  it('checks params against that capability\'s own schema', async () => {
    const bad = await call({ capability: 'insights.reports', params: { kind: 'weekly', count: 13 } });
    expect(bad.isError).toBe(true);
    expect(bad.json.problems.join(' ')).toMatch(/params\.count must be at most 12/);
    expect((await call({ capability: 'body.goal', params: { window: { lastDays: 3 } } })).json.problems.join(' ')).toMatch(/not an accepted argument/);
    expect((await call({ capability: 'insights.reports', params: { kind: 'weekly', count: 2 } })).isError).toBe(false);
  });

  it('answers an unknown capability with invalid_args naming every one it has', async () => {
    const r = await call({ capability: 'body.mood' });
    expect(r.isError).toBe(true);
    const text = JSON.stringify(r.json);
    for (const id of ['labs.documents', 'body.goal', 'body.nutrition_adherence', 'insights.current', 'insights.reports']) expect(text).toContain(id);
  });

  it('is an error for an unavailable store and not for an empty answer', async () => {
    expect((await call({ capability: 'labs.documents' }, toolCtx(healthyReaders({ labReports: async () => null })))).isError).toBe(true);
    const none = await call({ capability: 'body.goal' }, toolCtx(healthyReaders({ goalSummary: async () => null })));
    expect(none.isError).toBe(false);
    expect(none.json.status).toBe('no_data_in_window');
  });
});