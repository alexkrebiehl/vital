// ── A scripted model for the analyst integration tests ──────────────────────
//
// The service builds its provider from the environment, so the fake model is a
// small local HTTP server that speaks the OpenAI-compatible wire format. A test
// writes a SCRIPT: one function from (turn number, request body) to what the
// model does that turn. The same script serves the plain and the streamed path;
// the server answers in whichever form the request asked for. No real model, no
// network beyond 127.0.0.1.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setActiveDataset } from '../adapters/dataset';
import { testDataset } from './capabilities/test-dataset.fake';
import { askAnalyst, streamAnalyst, type AnalystDeps, type AnalystStreamChunk } from './service';
import type { AnalystRequest, AnalystResponse } from './types';

export type Message = { role: string; content?: string | null; tool_call_id?: string; tool_calls?: unknown[] };
export interface Body {
  stream?: boolean;
  tools?: { function: { name: string } }[];
  tool_choice?: string;
  messages: Message[];
}
export type Step = { say: string } | { call: [string, Record<string, unknown>][] } | { refuse: string };
export type Script = (turn: number, body: Body) => Step;

const servers: Server[] = [];

export async function closeModels(): Promise<void> {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
}

function plain(step: Step, turn: number): { status: number; json: unknown } {
  if ('refuse' in step) return { status: 400, json: { error: { message: step.refuse } } };
  const message =
    'say' in step
      ? { role: 'assistant', content: step.say }
      : { role: 'assistant', content: null, tool_calls: step.call.map(([name, args], i) => ({ id: `c${turn}-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) };
  return { status: 200, json: { model: 'm', choices: [{ index: 0, finish_reason: 'say' in step ? 'stop' : 'tool_calls', message }] } };
}

function frames(step: Exclude<Step, { refuse: string }>, turn: number): unknown[] {
  if ('say' in step) return [{ model: 'm', choices: [{ index: 0, delta: { content: step.say }, finish_reason: 'stop' }] }];
  return step.call.map(([name, args], i) => ({
    model: 'm',
    choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `c${turn}-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: i === step.call.length - 1 ? 'tool_calls' : null }],
  }));
}

export interface FakeModel {
  url: string;
  bodies: Body[];
}

export async function fakeModel(script: Script): Promise<FakeModel> {
  const bodies: Body[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Body;
      const turn = bodies.push(body) - 1;
      const step = script(turn, body);
      if (body.stream && !('refuse' in step)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const f of frames(step, turn)) res.write(`data: ${JSON.stringify(f)}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      const out = plain(step, turn);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

// ── What a script reads ─────────────────────────────────

/** The newest tool result in the request, parsed; null when there is none. */
export function lastToolResult(body: Body): Record<string, any> | null {
  const m = [...body.messages].reverse().find(x => x.role === 'tool');
  return m ? (JSON.parse(String(m.content).replace(/… \[truncated\]$/, '')) as Record<string, any>) : null;
}

export const lastUser = (body: Body): string => String([...body.messages].reverse().find(m => m.role === 'user')?.content ?? '');

export const reply = (analysis: string, uncertainty: string[] = []): string =>
  JSON.stringify({ title: 'Answer', analysis, recommendations: [], summary: [], uncertainty, evidence: [], followUps: [] });

// ── Running a question ──────────────────────────────────

export const modelEnv = (url: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: 'test-key', ANALYST_CONTEXT: 'full', VITAL_DATA_MODE: 'demo', ...extra }) as unknown as NodeJS.ProcessEnv;

const none = async () => null;
export const quiet = (env: NodeJS.ProcessEnv, extra: AnalystDeps = {}): AnalystDeps => ({ env, medicationLoader: none, labLoader: none, ...extra });

export type Path = 'ask' | 'stream';
export const PATHS: Path[] = ['ask', 'stream'];

export interface Ran {
  response: AnalystResponse;
  chunks: AnalystStreamChunk[];
}

/** One question through askAnalyst or streamAnalyst; the result is the same shape. */
export async function run(path: Path, request: AnalystRequest, deps: AnalystDeps): Promise<Ran> {
  if (path === 'ask') return { response: await askAnalyst(request, deps), chunks: [] };
  const chunks: AnalystStreamChunk[] = [];
  for await (const c of streamAnalyst(request, deps).chunks) chunks.push(c);
  const last = chunks.find((c): c is Extract<AnalystStreamChunk, { kind: 'result' }> => c.kind === 'result');
  if (!last) throw new Error('the stream ended without a result');
  return { response: last.response, chunks };
}

// ── The owner's data: 420 workouts, none in the last 30 days ──

const DAY_MS = 86_400_000;
const shift = (iso: string, days: number): string => new Date(Date.parse(iso) - days * DAY_MS).toISOString();

/**
 * The seeded dataset with every workout moved `days` earlier, so the starting selection's
 * 30-day roll-up holds none while the app still holds all 420 (the shape of the reported failure).
 */
export function installOlderWorkouts(days = 35) {
  const data = testDataset();
  const older = { ...data, workouts: data.workouts.map(w => ({ ...w, start_time: shift(w.start_time, days), end_time: shift(w.end_time, days) })) };
  setActiveDataset(older, { mode: 'demo' });
  return older;
}

/** The JSON object of the last untrusted block of the question message (the starting selection). */
export function selectionOf(user: string): { context: Record<string, any> } {
  const at = user.lastIndexOf('<<<UNTRUSTED_CONTEXT_START>>>');
  return JSON.parse(user.slice(at).replace('<<<UNTRUSTED_CONTEXT_START>>>', '').split('<<<UNTRUSTED_CONTEXT_END>>>')[0]!) as { context: Record<string, any> };
}
