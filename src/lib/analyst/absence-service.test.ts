// ── The absence audit through the service (design §5.5) ──────────────────────

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { askAnalyst, streamAnalyst, type AnalystStreamChunk } from './service';
import { installTestDataset } from './capabilities/test-dataset.fake';

const servers: Server[] = [];
beforeEach(() => void installTestDataset());
afterEach(async () => {
  resetToDemoDataset();
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

type Body = { tools?: unknown[]; messages: { role: string; content: string }[] };
type Reply = { status: number; json: unknown };
async function mockModel(reply: (n: number) => Reply) {
  const bodies: Body[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      const out = reply(bodies.length - 1);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

const said = (content: string): Reply => ({ status: 200, json: { model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] } });
const ANSWER = (analysis: string) => JSON.stringify({ title: 'Workouts', analysis, recommendations: [], summary: [], uncertainty: [], evidence: [], followUps: [] });
const CLAIM = ANSWER('This selection contains no workout records at all.');
const env = (url: string, extra: Record<string, string> = {}) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: '***', ANALYST_CONTEXT: 'full', VITAL_DATA_MODE: 'demo', ...extra }) as unknown as NodeJS.ProcessEnv;
const noMeds = async () => null;
const noLabs = async () => null;
const HELD = /^The app holds 420 Workout sessions from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d that were not part of this answer\.$/;

describe('with tools', () => {
  it('sends one corrective turn naming what the app holds and the tool to fetch it with', async () => {
    const model = await mockModel(n => (n === 0 ? said(CLAIM) : said(ANSWER('You logged workouts most weeks.'))));
    const r = await askAnalyst({ query: 'Did I work out in March?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(model.bodies).toHaveLength(2);
    const second = model.bodies[1]!;
    expect(second.tools?.length).toBeGreaterThan(0);
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^Your answer says there are no Workout sessions records\. The app holds 420 sessions from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d\. Fetch them with get_workouts before answering, then answer again in the same JSON shape\.$/);
    expect(r.status).toBe('ok');
    expect(r.answer?.analysis).toBe('You logged workouts most weeks.');
    expect(r.answer?.uncertainty).toEqual([]);
  });

  it('adds the app\'s own line when the answer keeps the claim after the correction', async () => {
    const model = await mockModel(() => said(CLAIM));
    const r = await askAnalyst({ query: 'Did I work out in March?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(model.bodies).toHaveLength(2);
    expect(r.answer?.uncertainty.some(u => HELD.test(u))).toBe(true);
  });

  it('leaves an answer that looked first alone', async () => {
    const toolCall: Reply = { status: 200, json: { model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_workouts', arguments: JSON.stringify({ window: { day: '2020-01-01' } }) } }] } }] } };
    const model = await mockModel(n => (n === 0 ? toolCall : said(ANSWER('No workouts were recorded on 2020-01-01. The app holds workouts from later dates.'))));
    const r = await askAnalyst({ query: 'Did I work out on 2020-01-01?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(model.bodies).toHaveLength(2);
    expect(r.answer?.uncertainty).toEqual([]);
  });
});

describe('without tools', () => {
  it('adds a line to uncertainty, computed from the coverage, and sends no extra turn', async () => {
    const model = await mockModel(() => said(CLAIM));
    const r = await askAnalyst({ query: 'Did I work out in March?' }, { env: env(model.url, { ANALYST_TOOLS: 'off' }), medicationLoader: noMeds, labLoader: noLabs });
    expect(model.bodies).toHaveLength(1);
    expect(r.answer?.uncertainty.filter(u => HELD.test(u))).toHaveLength(1);
    // The line comes from the app: it needs, and gets, no grounding.
    expect(r.grounding?.unmatched).toEqual([]);
  });

  it('adds it when the server refused the tools and the question was answered the ordinary way', async () => {
    const model = await mockModel(n => (n === 0 ? { status: 400, json: { error: { message: 'tools are not supported by this model' } } } : said(CLAIM)));
    const r = await askAnalyst({ query: 'Did I work out in March?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(r.toolsUnavailable).toMatch(/unavailable/);
    expect(r.answer?.uncertainty.some(u => HELD.test(u))).toBe(true);
  });

  it('adds nothing to an answer that claims nothing', async () => {
    const model = await mockModel(() => said(ANSWER('You logged workouts most weeks.')));
    const r = await askAnalyst({ query: 'Did I work out in March?' }, { env: env(model.url, { ANALYST_TOOLS: 'off' }), medicationLoader: noMeds, labLoader: noLabs });
    expect(r.answer?.uncertainty).toEqual([]);
  });
});

describe('streamed, without tools', () => {
  it('adds the same line to the result', async () => {
    const server = createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { content: CLAIM }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const { chunks } = streamAnalyst({ query: 'Did I work out in March?' }, { env: env(url, { ANALYST_TOOLS: 'off' }), medicationLoader: noMeds, labLoader: noLabs });
    const out: AnalystStreamChunk[] = [];
    for await (const c of chunks) out.push(c);
    const result = out.find((c): c is Extract<AnalystStreamChunk, { kind: 'result' }> => c.kind === 'result')!;
    expect(result.response.status).toBe('ok');
    expect(result.response.answer?.uncertainty.some(u => HELD.test(u))).toBe(true);
  });
});
