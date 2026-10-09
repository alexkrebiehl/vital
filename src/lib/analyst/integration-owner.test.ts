// ── The owner's scenario (design §1, §11) ───────────────────────────────────
//
// "Are my workouts associated with better sleep?", asked of an app that holds 420
// workouts over 400 days, none of them in the last 30 days, so the starting
// selection carries no workout. A model that reads the selection as the record says
// "no workout records". The app must not let that stand: it sends one corrective
// turn naming what the app holds, the model fetches, and the final answer has no
// absence claim. With tools refused, the model is told the selection is partial and
// the app adds its own uncertainty line. Through askAnalyst and streamAnalyst.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { answerFields, auditAbsence } from './capabilities/absence';
import { closeModels, fakeModel, installOlderWorkouts, lastToolResult, lastUser, modelEnv, PATHS, quiet, reply, run, selectionOf, type Script } from './integration.fake';

const QUESTION = 'Are my workouts associated with better sleep?';
const CLAIM = reply('This selection contains no workout records at all.');
const HELD = /^The app holds 420 Workout sessions from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d that were not part of this answer\.$/;
const NO_TOOLS = 'You cannot fetch more in this answer. For anything the question needs that is not here, say that it was not included in what you were given and how much of it the app holds (from the index); never say it is not recorded.';

let first = '';
let last = '';
beforeEach(() => {
  const data = installOlderWorkouts();
  const days = data.workouts.map(w => w.start_time.slice(0, 10)).sort();
  first = days[0]!;
  last = days.at(-1)!;
});
afterEach(async () => {
  resetToDemoDataset();
  await closeModels();
});

/** The model claims absence first, is audited, fetches workouts and sleep, then answers from them. */
function scripted(seen: { audit: string[]; results: Record<string, any>[] }): Script {
  return (n, body) => {
    if (n === 0) return { say: CLAIM };
    if (n === 1) {
      seen.audit.push(lastUser(body));
      return { call: [['get_workouts', { window: { lastDays: 400 }, view: 'summary' }], ['get_sleep', { window: { lastDays: 400 }, view: 'summary' }]] };
    }
    const r = lastToolResult(body)!;
    seen.results.push(r);
    return { say: reply(`You logged ${r.data?.totals?.display?.sessions ?? 'many'} workouts over the period; the sleep summary is in the evidence below.`) };
  };
}

describe.each(PATHS)('%s: full mode, tools offered', path => {
  it('audits the first reply, lets the model fetch, and ends without an absence claim', async () => {
    const seen = { audit: [] as string[], results: [] as Record<string, any>[] };
    const model = await fakeModel(scripted(seen));
    const { response } = await run(path, { query: QUESTION }, quiet(modelEnv(model.url)));

    // The first turn: the starting selection holds no workout, the coverage index line shows 420.
    const user = lastUser(model.bodies[0]!);
    const ctx = selectionOf(user).context;
    expect(ctx.workouts?.sessions ?? 0).toBe(0);
    expect(ctx.selection.complete).toBe(false);
    expect(user).toMatch(new RegExp(`^workouts\\.sessions · ${first}\\.\\.${last} · 420 sessions$`, 'm'));
    expect(model.bodies[0]!.tools?.map(t => t.function.name)).toContain('get_workouts');

    // The audit turn, with its exact text.
    expect(seen.audit).toEqual([
      `Your answer says there are no Workout sessions records. The app holds 420 sessions from ${first} to ${last}. Fetch them with get_workouts before answering, then answer again in the same JSON shape.`,
    ]);
    expect(model.bodies[1]!.tools).toBeDefined();

    // The model fetched, and the final answer is a valid, grounded answer with no absence claim.
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toEqual(['get_workouts', 'get_sleep']);
    expect(model.bodies).toHaveLength(3);
    expect(auditAbsence(answerFields(JSON.stringify(response.answer)), [], [])).toEqual([]);
    expect(JSON.stringify(response.answer)).not.toMatch(/no workout/i);
    expect(response.answer?.uncertainty.filter(u => HELD.test(u))).toEqual([]);
    expect(response.grounding.unmatched).toEqual([]);
  });

  it('adds the app\'s own line when the model keeps the claim after the one correction', async () => {
    const model = await fakeModel(() => ({ say: CLAIM }));
    const { response } = await run(path, { query: QUESTION }, quiet(modelEnv(model.url)));
    expect(model.bodies).toHaveLength(2);
    expect(response.answer?.uncertainty.some(u => HELD.test(u))).toBe(true);
  });
});

describe.each(PATHS)('%s: ondemand mode', path => {
  it('sends the index and no selection, audits the claim, and ends without it', async () => {
    const seen = { audit: [] as string[], results: [] as Record<string, any>[] };
    const model = await fakeModel(scripted(seen));
    const { response } = await run(path, { query: QUESTION }, quiet(modelEnv(model.url, { ANALYST_CONTEXT: 'ondemand' })));
    const user = lastUser(model.bodies[0]!);
    expect(user).toContain('INDEX of the reader\'s data');
    expect(user).not.toContain('STARTING SELECTION');
    expect(user).toMatch(new RegExp(`^workouts\\.sessions · ${first}\\.\\.${last} · 420 sessions$`, 'm'));
    expect(seen.audit[0]).toContain(`The app holds 420 sessions from ${first} to ${last}.`);
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toEqual(['get_workouts', 'get_sleep']);
    expect(JSON.stringify(response.answer)).not.toMatch(/no workout/i);
    expect(response.answer?.uncertainty.filter(u => HELD.test(u))).toEqual([]);
  });
});

describe.each(PATHS)('%s: tools refused before any tool', path => {
  for (const mode of ['full', 'ondemand']) {
    it(`${mode}: sends the no-tools selection wording and renders the uncertainty line`, async () => {
      const model = await fakeModel((_n, body) => (body.tools ? { refuse: 'tools are not supported by this model' } : { say: CLAIM }));
      const { response } = await run(path, { query: QUESTION }, quiet(modelEnv(model.url, { ANALYST_CONTEXT: mode })));
      const plain = model.bodies.filter(b => !b.tools);
      expect(plain.length).toBeGreaterThan(0);
      const user = lastUser(plain.at(-1)!);
      expect(user).toContain('STARTING SELECTION');
      expect(user).toContain(NO_TOOLS);
      expect(user).not.toContain('fetch it with the tools');
      expect(user).toMatch(new RegExp(`^workouts\\.sessions · ${first}\\.\\.${last} · 420 sessions$`, 'm'));
      expect(response.status).toBe('ok');
      expect(response.toolsUnavailable).toMatch(/unavailable/);
      expect(response.answer?.uncertainty.filter(u => HELD.test(u))).toHaveLength(1);
      expect(response.grounding.unmatched).toEqual([]);
    });
  }
});
