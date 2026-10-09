// ── The pieces of the live evaluation that run offline ──────────────────────
//
// Reading the calls out of a recorded request, and scoring them. The script itself is
// tested in script.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { installTestDataset } from '../capabilities/test-dataset.fake';
import { callsFromRequest } from './calls';
import { REF_KEY } from './match';
import { EVAL_QUESTIONS } from './questions';
import { hasAbsenceViolation, liveAuditEntries, scoreCalls } from './score';
import { DEMO } from '../capabilities/test-context.fake';

const q = (n: number) => EVAL_QUESTIONS.find(x => x.n === n)!;

describe('callsFromRequest', () => {
  it('reads OpenAI-compatible tool calls, with arguments as JSON text', () => {
    const body = {
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_sleep', arguments: '{"window":{"lastDays":7}}' } }] },
        { role: 'tool', tool_call_id: 'a', content: '{}' },
      ],
    };
    expect(callsFromRequest(body)).toEqual([{ tool: 'get_sleep', args: { window: { lastDays: 7 } } }]);
  });

  it('reads Anthropic tool_use blocks', () => {
    const body = { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'a', name: 'get_workouts', input: { limit: 1 } }] }] };
    expect(callsFromRequest(body)).toEqual([{ tool: 'get_workouts', args: { limit: 1 } }]);
  });

  it('reads nothing from a request without calls, or from something that is not a model request', () => {
    expect(callsFromRequest({ messages: [{ role: 'user', content: 'q' }] })).toEqual([]);
    expect(callsFromRequest({ messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'x', arguments: 'not json' } }] }] })).toEqual([{ tool: 'x', args: {} }]);
    expect(callsFromRequest(null)).toEqual([]);
    expect(callsFromRequest('x')).toEqual([]);
  });
});

describe('scoreCalls', () => {
  it('scores the tool and the window separately', () => {
    const right = { tool: 'get_workouts', args: { view: 'summary', window: { month: '2026-03' } } };
    expect(scoreCalls(q(2), [right])).toEqual({ toolCalled: true, windowMatched: true });
    expect(scoreCalls(q(2), [{ ...right, args: { view: 'summary', window: { month: '2026-04' } } }])).toEqual({ toolCalled: true, windowMatched: false });
    expect(scoreCalls(q(2), [])).toEqual({ toolCalled: false, windowMatched: false });
  });

  it('reports no window result for a question that names none', () => {
    expect(scoreCalls(q(30), [{ tool: 'list_capabilities', args: {} }])).toEqual({ toolCalled: true, windowMatched: null });
  });

  it('scores every oracle path as right', () => {
    for (const x of EVAL_QUESTIONS) expect(scoreCalls(x, x.oracle), `question ${x.n}`).toMatchObject({ toolCalled: true });
    expect(REF_KEY).toBe('2026-10-08');
  });
});

describe('hasAbsenceViolation', () => {
  beforeAll(() => void installTestDataset());
  afterAll(() => resetToDemoDataset());

  it('flags a claim of absence with no lookup, and lets the same claim stand after one', async () => {
    const entries = await liveAuditEntries('metric', DEMO);
    const response = { answer: { analysis: 'There are no workout records at all.', summary: [], uncertainty: [] } } as never;
    expect(hasAbsenceViolation(response, entries, [])).toBe(true);
    expect(hasAbsenceViolation(response, entries, [{ tool: 'get_workouts', args: {} }])).toBe(false);
    expect(hasAbsenceViolation({ answer: null } as never, entries, [])).toBe(false);
  });
});
