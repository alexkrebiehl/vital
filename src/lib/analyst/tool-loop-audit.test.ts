// ── The absence audit and the tool budget inside the tool loop (design §5.5, §8) ──

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { auditAbsence, answerFields, correctiveTurn } from './capabilities/absence';
import { auditEntries } from './capabilities/coverage-index';
import { CAPABILITIES } from './capabilities/registry';
import { installTestDataset } from './capabilities/test-dataset.fake';
import { testCtx } from './capabilities/test-context.fake';
import type { Coverage } from './capabilities/types';
import type { LoopMessage, ModelTurn, ToolCall, ToolCallingProvider } from './provider';
import { MAX_TOOL_OUTPUT_CHARS, REPAIR_INSTRUCTION, runToolLoop, TOOL_BUDGET_SENTENCE, type AbsenceAudit } from './tool-loop';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

const answer = (analysis: string) => JSON.stringify({ title: 'T', analysis, recommendations: [], summary: [], uncertainty: [], evidence: [], followUps: [] });
const CLAIM = answer('The selection contains no workout records.');
const OK = answer('You logged workouts on most weeks.');

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ id, name, args });
const text = (t: string): ModelTurn => ({ text: t, toolCalls: [], model: 'm' });
const calls = (...c: ToolCall[]): ModelTurn => ({ text: null, toolCalls: c, model: 'm' });

/** A model that plays a script and records what each turn was sent. */
function scripted(turns: ModelTurn[]) {
  const seen: { messages: LoopMessage[]; choice: string; tools: number }[] = [];
  const provider: ToolCallingProvider = {
    async converse(_system, messages, tools, choice = 'auto') {
      seen.push({ messages: [...messages], choice, tools: tools.length });
      const turn = turns[seen.length - 1];
      if (!turn) throw new Error(`The script has no turn ${seen.length}.`);
      return turn;
    },
  };
  return { provider, seen };
}

function toolCtx() {
  const c = testCtx();
  return { system: 'metric' as const, deps: c.routine, changes: [], data: c.access };
}

/** The coverage the question started with: the app holds workouts. */
const holds = (): Record<string, Coverage> => ({ 'workouts.sessions': { kind: 'known', first: '2025-09-04', last: '2026-10-08', count: 420, unit: 'sessions' }, 'workouts.summary': { kind: 'known', first: '2025-09-04', last: '2026-10-08', count: 420, unit: 'sessions' } });
const entries = () => {
  const rows = CAPABILITIES.map(c => ({ id: c.id, title: c.title, coverage: holds()[c.id] ?? ({ kind: 'known', first: null, last: null, count: 0, unit: 'x' } as Coverage) }));
  return auditEntries(CAPABILITIES, rows);
};
const audit: AbsenceAudit = (t, lookups) => {
  const violations = auditAbsence(answerFields(t), entries(), lookups);
  return violations.length ? { instruction: correctiveTurn(violations), violations } : null;
};
const lastUser = (m: LoopMessage[]) => (m.at(-1) as { content: string }).content;

describe('the corrective turn', () => {
  it('is sent once, with tools on, when the answer claims workouts are absent and none were looked up', async () => {
    const { provider, seen } = scripted([text(CLAIM), text(OK)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.choice).toBe('auto');
    expect(seen[1]!.tools).toBeGreaterThan(0);
    expect(lastUser(seen[1]!.messages)).toBe(
      'Your answer says there are no Workout sessions records. The app holds 420 sessions from 2025-09-04 to 2026-10-08. Fetch them with get_workouts before answering, then answer again in the same JSON shape.'
    );
    expect(r.text).toBe(OK);
    expect(r.unaddressed).toEqual([]);
  });

  it('lets the model fetch in it, and does not ask again for the answer that follows', async () => {
    const { provider, seen } = scripted([text(CLAIM), calls(call('c1', 'get_workouts', { window: { lastDays: 30 } })), text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(3);
    expect(r.toolsUsed).toEqual(['get_workouts']);
    expect(r.lookups).toEqual([expect.objectContaining({ tool: 'get_workouts', capability: 'workouts.sessions', status: 'ok' })]);
    // It looked, so a claim after the lookup is the model's report of it.
    expect(r.unaddressed).toEqual([]);
  });

  it('is never sent twice: an answer that ignores it is returned, and the app states what it holds', async () => {
    const { provider, seen } = scripted([text(CLAIM), text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(2);
    expect(r.text).toBe(CLAIM);
    expect(r.unaddressed.map(v => v.id).sort()).toEqual(['workouts.sessions', 'workouts.summary']);
  });

  it('is not sent after a lookup that found nothing in the window', async () => {
    const { provider, seen } = scripted([calls(call('c1', 'get_workouts', { window: { day: '2020-01-01' } })), text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(r.lookups[0]!.status).toBe('no_data_in_window');
    expect(seen).toHaveLength(2);
    expect(r.unaddressed).toEqual([]);
  });

  it('is not sent for an answer that claims nothing', async () => {
    const { provider, seen } = scripted([text(OK)]);
    await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(1);
  });

  it('shares the repair budget: a reply that needed the JSON repair is not also corrected', async () => {
    const { provider, seen } = scripted([text('There are no workout records, I think.'), text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(2);
    expect(lastUser(seen[1]!.messages)).toBe(REPAIR_INSTRUCTION);
    expect(seen[1]!.choice).toBe('none');
    expect(r.unaddressed.length).toBeGreaterThan(0);
  });

  it('and the other way: after a correction, a reply that is not JSON is returned, not repaired', async () => {
    const { provider, seen } = scripted([text(CLAIM), text('Prose again.')]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(2);
    expect(r.text).toBe('Prose again.');
    expect(r.draft).toBe('Prose again.');
  });

  it('is not sent when the next turn would be the forced final one; the app states what it holds', async () => {
    const list = (n: number) => calls(call(`c${n}`, 'list_capabilities', { area: 'sleep' }));
    const { provider, seen } = scripted([list(1), list(2), list(3), list(4), list(5), text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx(), undefined, undefined, audit);
    expect(seen).toHaveLength(6);
    expect(r.unaddressed.length).toBeGreaterThan(0);
  });

  it('does nothing without an audit', async () => {
    const { provider, seen } = scripted([text(CLAIM)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx());
    expect(seen).toHaveLength(1);
    expect(r.unaddressed).toEqual([]);
  });
});

describe('the tool output budget', () => {
  const big = (n: number) => call(`c${n}`, 'get_metric_series', { metrics: ['resting_heart_rate', 'step_count', 'heart_rate_variability'], window: { lastDays: 92 + n }, granularity: 'day' });

  it('answers every call past 48,000 characters with the budget sentence, and runs nothing', async () => {
    const { provider, seen } = scripted([calls(big(1), big(2), big(3)), calls(big(4), big(5), big(6)), text(OK)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx());
    const results = (seen[2]!.messages.at(-1) as Extract<LoopMessage, { role: 'tool' }>).results;
    const first = (seen[1]!.messages.at(-1) as Extract<LoopMessage, { role: 'tool' }>).results;
    const all = [...first, ...results];
    const exhausted = all.filter(x => x.content === JSON.stringify({ error: TOOL_BUDGET_SENTENCE }));
    expect(exhausted.length).toBeGreaterThan(0);
    // Everything before the first refusal was real output, and together it reached the budget.
    const ran = all.slice(0, all.length - exhausted.length);
    expect(ran.reduce((n, x) => n + x.content.length, 0)).toBeGreaterThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(all.slice(all.length - exhausted.length).every(x => x.isError)).toBe(true);
    // A refused call is not a lookup and is not counted as a tool used.
    expect(r.toolsUsed).toHaveLength(ran.length);
    expect(r.lookups).toHaveLength(ran.length);
  });

  it('is the design sentence', () => {
    expect(TOOL_BUDGET_SENTENCE).toBe('Tool budget for this question is used up; answer from what you have and say what you could not fetch.');
    expect(MAX_TOOL_OUTPUT_CHARS).toBe(48_000);
  });

  it('does not touch a question that stays under it', async () => {
    const { provider, seen } = scripted([calls(big(1)), text(OK)]);
    const r = await runToolLoop(provider, 'sys', 'q', toolCtx());
    const results = (seen[1]!.messages.at(-1) as Extract<LoopMessage, { role: 'tool' }>).results;
    expect(results[0]!.content).not.toContain(TOOL_BUDGET_SENTENCE);
    expect(r.toolsUsed).toEqual(['get_metric_series']);
  });
});
