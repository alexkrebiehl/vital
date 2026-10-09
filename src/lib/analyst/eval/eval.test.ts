// ── The evaluation set, offline (design §12) ────────────────────────────────
//
// An oracle model issues each question's expected calls against the synthetic world.
// This proves the plumbing for all 32 questions (the calls validate, return `ok` or the
// stated status, and the answer that follows reads, grounds and passes the absence
// audit). It says nothing about a real model's judgement: that is `npm run analyst:eval`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { FilePlanRepository } from '../../routine/store';
import type { TrainingData } from '../../workout-sources/store';
import { auditAbsence, answerFields } from '../capabilities/absence';
import { auditEntries, buildCoverageIndex } from '../capabilities/coverage-index';
import { CAPABILITIES } from '../capabilities/registry';
import { DEMO } from '../capabilities/test-context.fake';
import { REF } from '../capabilities/test-dataset.fake';
import { mergeFetched } from '../dataAccess';
import { GENERAL_HANDLER_ID, retrieveNone } from '../retrieval';
import { capabilityContext, isOutcome } from '../tools/capability-tool';
import type { ToolContext } from '../tools';
import { checkGrounding, parseAnalystReply } from '../validate';
import { evalWorld, type EvalWorld } from './fixtures';
import { runOracle } from './oracle';
import { EVAL_QUESTIONS } from './questions';

const held = vi.hoisted(() => ({ training: null as TrainingData | null }));
vi.mock('../../workout-sources/store', async importOriginal => ({
  ...(await importOriginal<typeof import('../../workout-sources/store')>()),
  loadTrainingData: async (): Promise<TrainingData> => held.training!,
}));

let dir: string;
let world: EvalWorld;
let ctx: ToolContext;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-eval-'));
  world = evalWorld();
  held.training = world.training;
  ctx = { system: 'metric', deps: { env: DEMO, repo: new FilePlanRepository(join(dir, 'plans.json')) }, changes: [], data: world.access };
});
afterAll(() => {
  resetToDemoDataset();
  rmSync(dir, { recursive: true, force: true });
});

describe('the question set', () => {
  it('is the 32 questions of the design, numbered in order, each distinct', () => {
    expect(EVAL_QUESTIONS.map(q => q.n)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(new Set(EVAL_QUESTIONS.map(q => q.text)).size).toBe(32);
    for (const q of EVAL_QUESTIONS) expect(q.oracle.length, `question ${q.n}`).toBeGreaterThan(0);
  });

  it('is never satisfied by a model that called nothing, or the wrong tool', () => {
    for (const q of EVAL_QUESTIONS) {
      expect(q.called([]), `question ${q.n} with no calls`).toBe(false);
      expect(q.called([{ tool: 'get_nothing', args: {} }]), `question ${q.n} with a wrong tool`).toBe(false);
    }
  });

  it('checks the window: a right tool on the wrong window does not match', () => {
    const wrong = (tool: string, args: Record<string, unknown>) => [{ tool, args }];
    const q = (n: number) => EVAL_QUESTIONS.find(x => x.n === n)!;
    expect(q(2).window(wrong('get_workouts', { view: 'summary', window: { month: '2026-04' } }))).toBe(false);
    expect(q(13).window(wrong('get_metric_series', { metrics: ['step_count'], window: { day: '2026-09-15' } }))).toBe(false);
    expect(q(32).window(wrong('get_workouts', { window: { month: '2024-05' } }))).toBe(false);
    expect(q(12).window(wrong('get_metric_series', { metrics: ['hrv'], window: { start: '2026-09-22', end: '2026-09-28' }, compareTo: 'previous' }))).toBe(false);
  });
});

describe.each(EVAL_QUESTIONS.map(q => [q.n, q] as const))('question %i', (_n, q) => {
  it(`${q.text}: the oracle's calls validate and answer, and its answer reads, grounds and passes the audit`, async () => {
    const run = await runOracle(q, ctx);
    const want = q.status ?? 'ok';

    // The calls are what the question expects, and each one was accepted.
    expect(q.called(q.oracle), 'called').toBe(true);
    expect(q.window(q.oracle), 'window').toBe(true);
    expect(q.oracle.every(c => q.tools.includes(c.tool)), 'tools').toBe(true);
    for (const c of run.calls) {
      expect(c.status, `${c.tool} -> ${c.text.slice(0, 200)}`).toBe(want);
      expect(c.isError).toBe(false);
    }

    // The answer: it reads, its figures come from the results, it claims no absence the app contradicts.
    const bundle = mergeFetched(retrieveNone(GENERAL_HANDLER_ID, REF), world.access);
    const parsed = parseAnalystReply(run.reply, { bundle });
    expect(parsed.ok, parsed.reason ?? '').toBe(true);
    expect(checkGrounding(parsed.answer!, bundle, 'metric', run.calls.map(c => c.text)).unmatched).toEqual([]);
    const cctx = capabilityContext(ctx);
    if (isOutcome(cctx)) throw new Error('no capability context');
    const entries = auditEntries(CAPABILITIES, (await buildCoverageIndex(CAPABILITIES, cctx)).rows);
    expect(auditAbsence(answerFields(run.reply), entries, run.lookups)).toEqual([]);
  });
});

describe('question 32, the data before the record', () => {
  it('states the coverage the lookup returned, and the same words without the lookup are an audit violation', async () => {
    const q = EVAL_QUESTIONS.find(x => x.n === 32)!;
    const run = await runOracle(q, ctx);
    expect(run.calls[0]!.body.coverage).toMatchObject({ kind: 'known', count: 420 });
    expect(run.reply).toContain('The app holds 420 sessions from');
    const cctx = capabilityContext(ctx);
    if (isOutcome(cctx)) throw new Error('no capability context');
    const entries = auditEntries(CAPABILITIES, (await buildCoverageIndex(CAPABILITIES, cctx)).rows);
    const claim = JSON.stringify({ analysis: 'There are no workout records in 2024.', uncertainty: [], summary: [] });
    expect(auditAbsence(answerFields(claim), entries, []).map(v => v.id)).toContain('workouts.sessions');
    expect(auditAbsence(answerFields(claim), entries, run.lookups)).toEqual([]);
  });
});
