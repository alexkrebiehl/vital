import { mkdtempSync, rmSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askAnalyst } from './service';
import { runToolLoop, MAX_TOOL_ROUNDS } from './tool-loop';
import { runTool, combineChanges, MAX_WRITES_PER_QUESTION, type ToolContext } from './tools';
import type { LoopMessage, ModelTurn, ToolCallingProvider, ToolSpec } from './provider';
import { startFromReference } from '../routine/actions';
import { FilePlanRepository } from '../routine/store';
import { findPath } from '../routine/validate';

const KEY = 'sk-tool-test-key-never-leak';
const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;

let dir: string;
let repo: FilePlanRepository;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-tools-'));
  repo = new FilePlanRepository(join(dir, 'plans.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const routineDeps = () => ({ env: DEMO, repo });
const ctx = (): ToolContext => ({ system: 'metric', deps: routineDeps(), changes: [] });

// ── A mock model server ─────────────────────────────────

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

async function mockModel(reply: (body: Record<string, unknown>, n: number) => { status?: number; body: unknown }) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      bodies.push(body);
      const out = reply(body, bodies.length - 1);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

const FINAL = JSON.stringify({
  title: 'Horizontal push',
  observed: ['The latest decline push-up session was 12/12/10 on 2026-09-17, 34 reps at RPE 8.5–9.5.'],
  interpretation: ['Reps sit near the top of the 8–12 range; repeat 3×10–12 at lower effort for 2–3 sessions.'],
  uncertainty: ['Form and joint comfort are not recorded.'],
  evidence: [],
  followUps: ['How is my sleep trending?'],
});

// ── OpenAI-compatible wire format ───────────────────────

describe('tool calling over the OpenAI-compatible protocol', () => {
  it('runs a tool, sends its result back, and grounds the answer in it', async () => {
    await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, routineDeps());
    const model = await mockModel((_b, n) =>
      n === 0
        ? { body: { model: 'm', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_routine_progress', arguments: '{"pathId":"horizontal-push"}' } }] } }] } }
        : { body: { model: 'm', choices: [{ message: { role: 'assistant', content: FINAL } }] } }
    );
    const response = await askAnalyst(
      { query: 'How is my push-up progression going?' },
      { env: { ANALYST_PROVIDER: 'openai', ANALYST_API_URL: model.url, ANALYST_MODEL: 'm', ANALYST_API_KEY: KEY } as unknown as NodeJS.ProcessEnv, routine: routineDeps() }
    );
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toEqual(['get_routine_progress']);
    expect(response.planChange).toBeNull();
    // Every figure in the answer came from the tool result.
    expect(response.grounding.unmatched).toEqual([]);

    const [first, second] = model.bodies;
    expect(first.response_format).toBeUndefined();
    expect((first.tools as { function: { name: string } }[]).map(t => t.function.name)).toContain('create_training_plan');
    expect(first.tool_choice).toBe('auto');
    const messages = second.messages as Record<string, unknown>[];
    const assistant = messages.find(m => m.role === 'assistant')!;
    expect((assistant.tool_calls as unknown[]).length).toBe(1);
    const tool = messages.find(m => m.role === 'tool')!;
    expect(tool.tool_call_id).toBe('c1');
    expect(String(tool.content)).toContain('Decline push-up 12/12/10');
    expect(JSON.stringify(model.bodies)).not.toContain(KEY);
  });

  it('answers without tools when the server rejects tool definitions', async () => {
    const model = await mockModel(body =>
      body.tools
        ? { status: 400, body: { error: { message: 'tools are not supported' } } }
        : { body: { model: 'm', choices: [{ message: { role: 'assistant', content: FINAL } }] } }
    );
    const response = await askAnalyst(
      { query: 'How is my push-up progression going?' },
      { env: { ANALYST_PROVIDER: 'openai', ANALYST_API_URL: model.url, ANALYST_MODEL: 'm', ANALYST_API_KEY: KEY } as unknown as NodeJS.ProcessEnv, routine: routineDeps() }
    );
    expect(response.status).toBe('ok');
    expect(response.toolsUsed).toBeUndefined();
    expect(model.bodies.some(b => !b.tools)).toBe(true);
  });
});

// ── Anthropic wire format ───────────────────────────────

describe('tool calling over the Anthropic protocol', () => {
  it('makes a plan change through a tool and reports it for undo', async () => {
    await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, routineDeps());
    const model = await mockModel((_b, n) =>
      n === 0
        ? { body: { model: 'claude-test', stop_reason: 'tool_use', content: [
            { type: 'text', text: 'Pausing the core path.' },
            { type: 'tool_use', id: 'toolu_1', name: 'set_path_hold', input: { pathId: 'core', kind: 'hold', reason: 'Mild low-back discomfort after reverse crunches' } },
          ] } }
        : { body: { model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: FINAL }] } }
    );
    const response = await askAnalyst(
      { query: 'My low back is sore after reverse crunches' },
      { env: { ANALYST_PROVIDER: 'anthropic', ANALYST_API_URL: model.url, ANALYST_MODEL: 'claude-test', ANALYST_API_KEY: KEY } as unknown as NodeJS.ProcessEnv, routine: routineDeps() }
    );
    expect(response.status).toBe('ok');
    expect(response.planChange).toMatchObject({ kind: 'update', fromRevision: 1, toRevision: 2 });
    expect(response.planChange!.diff).toEqual(['Core: on hold (Mild low-back discomfort after reverse crunches)']);
    const active = await repo.active();
    expect(findPath(active!.plan, 'core')!.path.hold?.reason).toMatch(/low-back/);

    const second = model.bodies[1];
    expect((second.tools as { name: string }[]).some(t => t.name === 'set_path_hold')).toBe(true);
    const msgs = second.messages as { role: string; content: unknown }[];
    expect(msgs[1]).toMatchObject({ role: 'assistant' });
    expect(msgs[2].content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1' })]);
  });
});

// ── Loop limits ─────────────────────────────────────────

class ScriptedModel implements ToolCallingProvider {
  seen: { choice: string | undefined; messages: number }[] = [];
  constructor(private readonly turn: (n: number, choice: string | undefined) => ModelTurn) {}
  async converse(_s: string, messages: LoopMessage[], _t: ToolSpec[], choice?: 'auto' | 'none'): Promise<ModelTurn> {
    this.seen.push({ choice, messages: messages.length });
    return this.turn(this.seen.length - 1, choice);
  }
}

describe('runToolLoop limits', () => {
  it('forces an answer on the last round', async () => {
    const model = new ScriptedModel((_n, choice) =>
      choice === 'none'
        ? { text: FINAL, toolCalls: [], model: 'x' }
        : { text: null, toolCalls: [{ id: 'a', name: 'get_training_plan', args: {} }], model: 'x' }
    );
    const result = await runToolLoop(model, 'sys', 'q', ctx());
    expect(result.text).toBe(FINAL);
    expect(model.seen).toHaveLength(MAX_TOOL_ROUNDS);
    expect(model.seen[MAX_TOOL_ROUNDS - 1].choice).toBe('none');
  });

  it('reports a model that never answers', async () => {
    const model = new ScriptedModel(() => ({ text: null, toolCalls: [{ id: 'a', name: 'get_training_plan', args: {} }], model: 'x' }));
    await expect(runToolLoop(model, 'sys', 'q', ctx())).rejects.toThrow(/never answered/);
  });
});

// ── Tools ───────────────────────────────────────────────

describe('tools', () => {
  it('reject unknown tools and bad arguments with a fixable error', async () => {
    expect(JSON.parse((await runTool('nope', {}, ctx())).content).error).toMatch(/There is no tool "nope"/);
    const bad = await runTool('set_path_hold', { pathId: 'core', kind: 'forever' }, ctx());
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content).problems).toEqual(['arguments.reason is required.', 'arguments.kind must be one of: hold, regress.']);
  });

  it('return validation problems for an invalid plan instead of saving it', async () => {
    const out = await runTool('create_training_plan', { plan: { title: 'x' }, summary: 'try' }, ctx());
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content).problems.some((p: string) => p.startsWith('plan.goal'))).toBe(true);
    expect(await repo.active()).toBeNull();
  });

  it('create, patch and move a stage, then combine the changes into one undo', async () => {
    const c = ctx();
    const plan = JSON.parse((await runTool('get_reference_plan', { id: 'strength' }, c)).content);
    expect((await runTool('create_training_plan', { plan, summary: 'New strength block', inferStagesFromHistory: false }, c)).isError).toBe(false);
    const patched = await runTool('update_training_plan', {
      ops: [{ op: 'set', path: 'focusAreas[main-lifts].paths[bench].params', value: { incrementKg: 1.25 } }],
      summary: 'Smaller bench jumps',
    }, c);
    expect(patched.isError).toBe(false);
    const moved = await runTool('set_current_stage', { pathId: 'squat', stageId: 'nope', reason: 'x' }, c);
    expect(JSON.parse(moved.content).problems[0]).toMatch(/has no stage "nope"/);
    expect(c.changes).toHaveLength(2);
    const combined = combineChanges(c.changes)!;
    expect(combined).toMatchObject({ kind: 'create', fromRevision: null, toRevision: 2 });
    expect(combined.diff).toContain('Bench press: progression model settings changed');
  });

  it(`allow at most ${MAX_WRITES_PER_QUESTION} plan changes per question`, async () => {
    await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, routineDeps());
    const c = ctx();
    for (let i = 0; i < MAX_WRITES_PER_QUESTION; i++) {
      expect((await runTool('record_deload', { startedOn: `2026-09-1${i}` }, c)).isError).toBe(false);
    }
    const blocked = await runTool('record_deload', {}, c);
    expect(JSON.parse(blocked.content).error).toMatch(/At most 3 plan changes/);
  });

  it('read logged sessions filtered by exercise', async () => {
    const out = JSON.parse((await runTool('get_training_sessions', { days: 14, exercise: 'decline push up' }, ctx())).content);
    expect(out.origin).toBe('demo');
    expect(out.sessions[0].exercises).toEqual([expect.objectContaining({ name: 'Decline Push Up', sets: ['12 reps RPE 8.5', '12 reps RPE 9', '10 reps RPE 9.5'] })]);
  });
});

// ── Demo analyst ────────────────────────────────────────

describe('demo analyst plan requests', () => {
  const ask = (query: string) => askAnalyst({ query }, { env: DEMO, routine: routineDeps() });

  it('creates, reviews and pauses without a model', async () => {
    const created = await ask('Create a 6-month calisthenics plan');
    expect(created.status).toBe('ok');
    expect(created.planChange?.kind).toBe('create');
    expect(created.answer?.observed.join(' ')).toContain('Horizontal push: Decline push-up');

    const status = await ask('How is my routine going?');
    expect(status.answer?.title).toMatch(/week 13 of 26/);

    const paused = await ask('My low back is sore after reverse crunches');
    expect(paused.planChange?.diff[0]).toMatch(/^Core: on hold/);
  });

  it('asks which kind of plan when no example matches', async () => {
    const r = await ask('Create a plan for my goals');
    expect(r.planChange).toBeNull();
    expect(r.answer?.title).toBe('Which kind of plan?');
  });

  it('leaves other questions to the regular handlers', async () => {
    const r = await ask('How is my HRV trending?');
    expect(r.handlerId).toBe('hrv-trend');
  });
});
