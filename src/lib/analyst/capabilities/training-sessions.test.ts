// ── get_training_sessions: a window, and a page instead of a silent cut ─────
//
// The strength sessions are whatever the test hands the store; nothing here reads
// a workout source, the database or a model.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { startFromReference } from '../../routine/actions';
import { loadRoutine } from '../../routine/service';
import { FilePlanRepository } from '../../routine/store';
import type { TrainingData } from '../../workout-sources/store';
import type { TrainingSession } from '../../workout-sources/types';
import { ANALYST_TOOLS, overviewSummary, runTool, type ToolContext } from '../tools';
import { installTestDataset, REF } from './test-dataset.fake';

const held = vi.hoisted(() => ({ sessions: [] as TrainingSession[] }));
vi.mock('../../workout-sources/store', async importOriginal => ({
  ...(await importOriginal<typeof import('../../workout-sources/store')>()),
  loadTrainingData: async (): Promise<TrainingData> => ({ origin: 'demo', sessions: held.sessions, statuses: [] }),
}));

const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-train-'));
  installTestDataset();
  held.sessions = sessionsBefore(REF, 60);
});
afterEach(() => {
  resetToDemoDataset();
  rmSync(dir, { recursive: true, force: true });
});

/** One session a day for `count` days, ending on `last`, oldest first (as the store returns them). */
function sessionsBefore(last: string, count: number): TrainingSession[] {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(last, -(count - 1 - i));
    return {
      id: `s${i}`,
      sourceId: 'test',
      title: `Session ${day}`,
      startTime: `${day}T14:00:00.000Z`,
      endTime: `${day}T15:00:00.000Z`,
      exercises: [{ sourceTemplateId: 'sq', name: i % 2 ? 'Back squat' : 'Bench press', loadMeaning: 'added' as const, sets: [{ index: 0, kind: 'normal' as const, reps: 5, weightKg: 80 }] }],
    };
  });
}

const ctx = (): ToolContext => ({ system: 'metric', deps: { env: DEMO, repo: new FilePlanRepository(join(dir, 'plans.json')) }, changes: [] });
type Out = { window: string; sessions: { date: string; title: string }[]; page?: { returned: number; total: number; how: string }; error?: string; clipped?: string };
async function call(args: Record<string, unknown>) {
  const r = await runTool('get_training_sessions', args, ctx());
  return { isError: r.isError, json: JSON.parse(r.content) as Out };
}

describe('get_training_sessions window', () => {
  it('dates the sessions by start and end, newest first', async () => {
    const r = await call({ start: addDays(REF, -9), end: addDays(REF, -5) });
    expect(r.isError).toBe(false);
    expect(r.json.sessions.map(s => s.date)).toEqual([-5, -6, -7, -8, -9].map(n => addDays(REF, n)));
    expect(r.json.window).toBe(`${addDays(REF, -9)} → ${addDays(REF, -5)}`);
    expect(r.json.page).toBeUndefined();
  });

  it('keeps days as the default window of 42 days', async () => {
    const r = await call({});
    expect(r.json.window).toBe(`${addDays(REF, -42)} → ${REF}`);
    expect(r.json.sessions[0].date).toBe(REF);
    expect((await call({ days: 3 })).json.sessions).toHaveLength(4);
  });

  it('clips an end after today and says so', async () => {
    const r = await call({ start: addDays(REF, -2), end: addDays(REF, 10) });
    expect(r.json.window).toBe(`${addDays(REF, -2)} → ${REF}`);
    expect(r.json.clipped).toMatch(/clipped to today/);
    expect(r.json.sessions).toHaveLength(3);
  });

  it('refuses days with a window, half a window, a future one, and a bad date', async () => {
    expect((await call({ days: 5, start: addDays(REF, -3), end: REF })).json.error).toMatch(/either days or start and end/);
    expect((await call({ start: addDays(REF, -3) })).json.error).toMatch(/start and end go together/);
    expect((await call({ start: addDays(REF, 1), end: addDays(REF, 3) })).json.error).toMatch(/after today/);
    expect((await call({ start: '2026-02-30', end: REF })).json.error).toMatch(/not a real calendar day/);
    expect((await call({ start: addDays(REF, 3), end: REF })).isError).toBe(true);
  });

  it('still filters by exercise inside the window', async () => {
    const r = await call({ start: addDays(REF, -5), end: REF, exercise: 'bench' });
    expect(r.json.sessions.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.json.sessions)).not.toMatch(/Back squat/);
  });
});

describe('get_training_sessions page', () => {
  it('returns 40 of 60 matching sessions and says there are more, rather than cutting silently', async () => {
    const r = await call({ days: 90 });
    expect(r.json.sessions).toHaveLength(40);
    expect(r.json.sessions[0].date).toBe(REF);
    expect(r.json.page).toMatchObject({ returned: 40, total: 60 });
    expect(r.json.page!.how).toBe('40 of 60 shown, newest first. Give start and end (or exercise) to see the others.');
  });

  it('pages nothing when 40 or fewer match', async () => {
    held.sessions = sessionsBefore(REF, 40);
    const r = await call({ days: 90 });
    expect(r.json.sessions).toHaveLength(40);
    expect(r.json.page).toBeUndefined();
  });

  it('lets a narrower window reach the older sessions', async () => {
    const r = await call({ start: addDays(REF, -59), end: addDays(REF, -40) });
    expect(r.json.sessions).toHaveLength(20);
    expect(r.json.sessions[19].date).toBe(addDays(REF, -59));
  });
});

describe('what the model reads about the workout source', () => {
  const tool = ANALYST_TOOLS.find(t => t.name === 'get_training_sessions')!;

  it('describes the tool without naming a product, and mentions the window', () => {
    expect(tool.description).not.toMatch(/hevy|oura|health auto export|\bHAE\b/i);
    expect(tool.description).toMatch(/connected workout source/);
    expect(tool.description).toMatch(/start and end/);
  });

  it('words the no-source note of the routine overview without a product', async () => {
    await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, { env: DEMO, repo: new FilePlanRepository(join(dir, 'plans.json')) });
    const loaded = await loadRoutine('metric', { env: DEMO, repo: new FilePlanRepository(join(dir, 'plans.json')) });
    const note = (overviewSummary({ ...loaded.routine!, exerciseData: false }) as { exerciseData?: string }).exerciseData;
    expect(note).toMatch(/connected workout source/);
    expect(note).not.toMatch(/hevy/i);
  });

  it('keeps the plan write tools exactly as they were', () => {
    expect(ANALYST_TOOLS.filter(t => t.kind === 'write').map(t => t.name)).toEqual([
      'create_training_plan',
      'update_training_plan',
      'set_current_stage',
      'set_path_hold',
      'clear_path_hold',
      'record_deload',
      'archive_training_plan',
    ]);
  });
});
