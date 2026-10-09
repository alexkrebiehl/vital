// ── The analyst, end to end, with a scripted model (design §11) ─────────────
//
// Every test runs the real service twice, once through askAnalyst and once through
// streamAnalyst, against the seeded synthetic dataset and a local fake model. The
// owner's scenario is in integration-owner.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { installTestDataset } from './capabilities/test-dataset.fake';
import { closeModels, fakeModel, lastToolResult, modelEnv, PATHS, quiet, reply, run, type Script } from './integration.fake';

beforeEach(() => void installTestDataset());
afterEach(async () => {
  resetToDemoDataset();
  await closeModels();
});

describe.each(PATHS)('%s: a tool call, then an answer', path => {
  it('runs the tool, validates the answer, accepts the quoted figure and records the tool', async () => {
    let quoted = '';
    const script: Script = (n, body) => {
      if (n === 0) return { call: [['get_metric_series', { metrics: ['resting_heart_rate'], window: { lastDays: 30 } }]] };
      quoted = lastToolResult(body)!.data.metrics[0].summary.mean as string;
      return { say: reply(`Your resting heart rate averaged ${quoted} over the last 30 days.`) };
    };
    const model = await fakeModel(script);
    const { response } = await run(path, { query: 'How has my resting heart rate been lately?' }, quiet(modelEnv(model.url)));
    expect(quoted).toMatch(/^\d+\.\d bpm$/);
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toEqual(['get_metric_series']);
    expect(response.answer?.analysis).toContain(quoted);
    expect(response.grounding.checked).toBeGreaterThan(0);
    expect(response.grounding.unmatched).toEqual([]);
    // The tool result went back to the model as a tool message, and the tools were offered.
    expect(model.bodies).toHaveLength(2);
    expect(model.bodies[0]!.tools?.map(t => t.function.name)).toContain('get_metric_series');
    expect(model.bodies[1]!.messages.at(-1)!.role).toBe('tool');
  });

  it('flags a figure that no tool returned', async () => {
    const model = await fakeModel(n =>
      n === 0 ? { call: [['get_metric_series', { metrics: ['resting_heart_rate'], window: { lastDays: 30 } }]] } : { say: reply('Your resting heart rate averaged 93.7 bpm.') }
    );
    const { response } = await run(path, { query: 'How has my resting heart rate been lately?' }, quiet(modelEnv(model.url)));
    expect(response.status).toBe('ok');
    expect(response.grounding.unmatched.join(' ')).toContain('93.7');
  });

  it('pages over 420 workouts in two calls with offset', async () => {
    const seen: Record<string, any>[] = [];
    const model = await fakeModel((n, body) => {
      if (n === 0) return { call: [['get_workouts', { window: { lastDays: 400 } }]] };
      seen.push(lastToolResult(body)!);
      if (n === 1) return { call: [['get_workouts', { window: { lastDays: 400 }, offset: seen[0]!.page.nextOffset }]] };
      return { say: reply(`I read ${seen[0]!.page.returned + seen[1]!.page.returned} of ${seen[1]!.page.total} workouts.`) };
    });
    const { response } = await run(path, { query: 'List my workouts' }, quiet(modelEnv(model.url)));
    const [first, second] = seen;
    expect(first!.page).toMatchObject({ total: 420, offset: 0, returned: 20, nextOffset: 20 });
    expect(second!.page).toMatchObject({ total: 420, offset: 20, returned: 20, nextOffset: 40 });
    const ids = [...first!.data.sessions, ...second!.data.sessions].map((s: { id: string }) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first!.data.sessions[0].id).toBe('w-0400');
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toEqual(['get_workouts', 'get_workouts']);
    expect(response.grounding.unmatched).toEqual([]);
    expect(model.bodies).toHaveLength(3);
  });
});
