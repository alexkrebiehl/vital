// ── Streaming through the training-plan tools ───────────
//
// The streaming service runs the same tool loop as askAnalyst, with every model
// turn streamed: tool-call fragments are assembled by index, a `step` chunk
// marks each tool, the page context reaches the model, and the result carries
// the plan change. A server that refuses tool definitions still streams an
// answer, with the note that the tools were unavailable.

import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { streamAnalyst, type AnalystStreamChunk } from './service';
import { startFromReference } from '../routine/actions';
import { FilePlanRepository } from '../routine/store';

const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;
let dir: string;
let repo: FilePlanRepository;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-stream-tools-'));
  repo = new FilePlanRepository(join(dir, 'plans.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const routineDeps = () => ({ env: DEMO, repo });

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

type Reply = { status: number; json: unknown } | { sse: unknown[] };

/** A model server answering request n with `replies[n]`, recording each body. */
async function mockModel(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}') as Record<string, unknown>);
      const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
      if ('sse' in reply) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const frame of reply.sse) res.write(`data: ${JSON.stringify(frame)}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.json));
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

const env = (url: string) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: 'sk-never-leak' }) as unknown as NodeJS.ProcessEnv;

const FINAL = JSON.stringify({
  title: 'Core paused',
  observed: ['Core is on hold for mild low-back discomfort.'],
  interpretation: ['Other paths continue as planned.'],
  uncertainty: ['Discomfort is self-reported.'],
  evidence: [],
  followUps: ['When should I clear the hold?'],
});

async function collect(chunks: AsyncGenerator<AnalystStreamChunk>): Promise<AnalystStreamChunk[]> {
  const out: AnalystStreamChunk[] = [];
  for await (const c of chunks) out.push(c);
  return out;
}

describe('streaming with the training-plan tools', () => {
  it('assembles a streamed tool call, runs it, and streams the answer that follows', async () => {
    const { stored } = await startFromReference('calisthenics', { source: 'user', summary: 'setup' }, routineDeps());
    const core = stored.plan.focusAreas[3].paths[0].id;
    const args = JSON.stringify({ pathId: core, kind: 'hold', reason: 'mild low-back discomfort' });
    const model = await mockModel([
      {
        sse: [
          { model: 'm', choices: [{ delta: { reasoning: 'The reader wants core paused.' } }] },
          { choices: [{ delta: { content: 'Pausing it now.' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'set_path_hold', arguments: '' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 10) } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }, finish_reason: 'tool_calls' }] },
        ],
      },
      { sse: [{ model: 'm', choices: [{ delta: { content: FINAL.slice(0, 20) } }] }, { choices: [{ delta: { content: FINAL.slice(20) }, finish_reason: 'stop' }] }] },
    ]);

    const { chunks } = streamAnalyst(
      { query: 'Pause this path, my lower back hurts', context: { kind: 'routine-path', pathId: core } },
      { env: env(model.url), routine: routineDeps() }
    );
    const out = await collect(chunks);

    const kinds = out.map(c => c.kind);
    expect(kinds.indexOf('step')).toBeGreaterThan(kinds.indexOf('answer'));
    expect(out.find(c => c.kind === 'step')).toEqual({ kind: 'step', tool: 'set_path_hold' });
    expect(out.filter(c => c.kind === 'reasoning').map(c => (c as { text: string }).text).join('')).toContain('core paused');
    const streamed = out.filter(c => c.kind === 'answer').map(c => (c as { text: string }).text).join('');
    expect(streamed).toBe(`Pausing it now.${FINAL}`);

    const result = out.at(-1)!;
    if (result.kind !== 'result') throw new Error('no result');
    expect(result.response.status).toBe('ok');
    expect(result.response.answer?.title).toBe('Core paused');
    expect(result.response.toolsUsed).toEqual(['set_path_hold']);
    expect(result.response.planChange?.diff.join(' ')).toMatch(/on hold/);
    expect((await repo.active())?.plan.focusAreas[3].paths[0].hold?.reason).toBe('mild low-back discomfort');

    // Every turn was streamed with the tools, the page context was in the prompt,
    // and the tool result went back to the model.
    expect(model.bodies).toHaveLength(2);
    expect(model.bodies.every(b => b.stream === true && Array.isArray(b.tools))).toBe(true);
    const messages = model.bodies[0].messages as { role: string; content: string }[];
    expect(messages[1].content).toContain(`pathId "${core}"`);
    const second = model.bodies[1].messages as { role: string; tool_call_id?: string }[];
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('streams a tool-less answer, with the note, when the server refuses tool definitions', async () => {
    const model = await mockModel([
      { status: 400, json: { error: { message: 'tools are not supported by this model' } } },
      { status: 400, json: { error: { message: 'tools are not supported by this model' } } },
      { sse: [{ model: 'm', choices: [{ delta: { content: FINAL }, finish_reason: 'stop' }] }] },
    ]);
    const { chunks } = streamAnalyst({ query: 'How is my routine going?' }, { env: env(model.url), routine: routineDeps() });
    const out = await collect(chunks);
    const result = out.at(-1)!;
    if (result.kind !== 'result') throw new Error('no result');
    expect(result.response.status).toBe('ok');
    expect(result.response.toolsUnavailable).toMatch(/Plan tools were unavailable/);
    expect(out.some(c => c.kind === 'step')).toBe(false);
    expect(model.bodies.at(-1)!.tools).toBeUndefined();
  });
});
