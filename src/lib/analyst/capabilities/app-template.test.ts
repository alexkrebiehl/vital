// ── get_app_data: training.workout_template ─────────────────────────────────
//
// One session template of the active plan as a day of training, as the workout page
// serves it: against a real plan store in a temp directory, the demo workout source
// and the seeded dataset.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { startFromReference } from '../../routine/actions';
import { loadRoutine } from '../../routine/service';
import { FilePlanRepository } from '../../routine/store';
import { installBodyDataset } from './app.fake';
import { appCtxWith } from './app-ctx.fake';
import { DEMO, expectClean } from './test-context.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import type { CapabilityContext } from './types';

let dir: string;
let ctx: CapabilityContext;
const meta = { source: 'user' as const, summary: 'test' };

beforeEach(() => {
  installBodyDataset();
  dir = mkdtempSync(join(tmpdir(), 'vital-template-'));
  ctx = appCtxWith(undefined, { routine: { env: DEMO, repo: new FilePlanRepository(join(dir, 'plans.json')) } });
});
afterEach(() => {
  resetToDemoDataset();
  rmSync(dir, { recursive: true, force: true });
});

const read = (args: Record<string, unknown>, c = ctx): Promise<Envelope<unknown>> => capabilityById('training.workout_template')!.read(args, c);
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;

describe('training.workout_template', () => {
  it('says there is no plan when none is active', async () => {
    const env = await read({ templateId: 'a' });
    expect(env).toMatchObject({ status: 'no_data_in_window', next: 'There is no active training plan.' });
  });

  it('gives the template as the route does: its domains, each slot\'s stage, dose and light', async () => {
    await startFromReference('calisthenics', meta, ctx.routine);
    const routine = (await loadRoutine('metric', ctx.routine)).routine!;
    const wanted = routine.workouts[0];
    const env = await read({ templateId: wanted.id });
    expectClean(env);
    const workout = data(env);
    expect(workout).toMatchObject({ id: wanted.id, name: wanted.name });
    expect(workout.domains.length).toBeGreaterThan(0);
    const slot = workout.domains[0].slots[0];
    expect(slot).toMatchObject({ path: expect.any(String), stage: expect.any(String), dose: expect.any(String), light: expect.any(String) });
  });

  it('leaves out the rest of the routine, the sources and their hosts', async () => {
    await startFromReference('calisthenics', meta, ctx.routine);
    const id = (await loadRoutine('metric', ctx.routine)).routine!.workouts[0].id;
    const text = JSON.stringify(await read({ templateId: id }));
    for (const other of ['"routine"', '"sources"', '"origin"', '"host"', 'lastError']) expect(text).not.toContain(other);
  });

  it('refuses an unknown template, listing the ones the plan has', async () => {
    await startFromReference('calisthenics', meta, ctx.routine);
    const ids = (await loadRoutine('metric', ctx.routine)).routine!.workouts.map(w => w.id);
    const env = await read({ templateId: 'nope' });
    expect(env.status).toBe('invalid_args');
    expect(env.next).toContain('The active plan has no workout "nope"');
    for (const id of ids) expect(JSON.stringify(env)).toContain(id);
  });

  it('refuses a missing template id', async () => {
    expect((await read({})).status).toBe('invalid_args');
  });

  it('is unavailable when the plan store cannot be read', async () => {
    const broken = { ...ctx, routine: { env: DEMO, repo: { active: async () => { throw new Error('cannot read https://plans.internal.example.com'); } } as never } };
    const env = await read({ templateId: 'a' }, broken);
    expect(env.status).toBe('source_unavailable');
    expect(JSON.stringify(env)).not.toContain('example.com');
  });
});
