// ── The data tools in the deployed (full) context mode ──────────────────────
//
// What this pins: `ANALYST_CONTEXT=full` still pre-attaches the selection, and the
// data tools are offered as well, so a model can fetch what the selection left
// out. The answer is audited against the selection plus whatever the tools
// returned.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { addDays } from '../analytics/windows';
import { askAnalyst } from './service';
import { installTestDataset, REF } from './capabilities/test-dataset.fake';

const servers: Server[] = [];
beforeEach(() => void installTestDataset());
afterEach(async () => {
  resetToDemoDataset();
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

type Reply = { status: number; json: unknown };
async function mockModel(reply: (n: number) => Reply) {
  const bodies: Record<string, any>[] = [];
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

const toolCall = (name: string, args: unknown): Reply => ({
  status: 200,
  json: { model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
});
const said = (content: string): Reply => ({ status: 200, json: { model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] } });
const ANSWER = (analysis: string) => JSON.stringify({ title: 'Workouts', analysis, recommendations: [], summary: [], uncertainty: [], evidence: [], followUps: [] });

const env = (url: string) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: '***', ANALYST_CONTEXT: 'full', VITAL_DATA_MODE: 'demo' }) as unknown as NodeJS.ProcessEnv;
const noMeds = async () => null;
const noLabs = async () => null;

describe('full context mode', () => {
  it('pre-attaches the selection and offers the data tools beside it', async () => {
    const model = await mockModel(() => said(ANSWER('Nothing to fetch.')));
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });

    const names = (model.bodies[0].tools as { function: { name: string } }[]).map(t => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['get_workouts', 'get_sleep', 'get_blood_pressure', 'get_metric_series', 'get_lab_results', 'get_routine_progress']));
    // The two tools get_metric_series replaced are gone.
    expect(names).not.toContain('get_metrics');
    expect(names).not.toContain('compare_periods');
    expect(model.bodies[0].messages.at(-1).content).toContain('"context"');
    const system = model.bodies[0].messages[0].content as string;
    expect(system).toContain('Any selection in the message is a STARTING SELECTION, not the record.');
    expect(system).toContain('workouts.sessions — Workout sessions');
    const user = model.bodies[0].messages.at(-1).content as string;
    expect(user.indexOf('COVERAGE')).toBeGreaterThan(-1);
    expect(user.indexOf('COVERAGE')).toBeLessThan(user.indexOf('"selection"'));
  });

  it('runs a data tool call and audits the answer against what it returned', async () => {
    const { workoutList } = await import('../adapters/dataset');
    const { workoutDayKey } = await import('../analytics/workouts');
    const in90 = workoutList().filter(w => workoutDayKey(w) >= addDays(REF, -89)).length;
    const in30 = workoutList().filter(w => workoutDayKey(w) >= addDays(REF, -29)).length;
    expect(in90).not.toBe(in30);

    const model = await mockModel(n => (n === 0 ? toolCall('get_workouts', { window: { lastDays: 90 }, limit: 5 }) : said(ANSWER(`You logged ${in90} workouts in the last 90 days.`))));
    const r = await askAnalyst({ query: 'How many workouts did I log in the last 90 days?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });

    expect(r.status).toBe('ok');
    expect(r.toolsUsed).toEqual(['get_workouts']);
    const toolMessage = model.bodies[1].messages.at(-1);
    expect(toolMessage.role).toBe('tool');
    // Individual sessions, not a roll-up: the failure this gate exists to fix.
    const result = JSON.parse(toolMessage.content);
    expect(result.data.sessions).toHaveLength(5);
    expect(result.data.sessions[0]).toMatchObject({ id: expect.stringMatching(/^w-/), type: expect.any(String) });
    expect(result.page.total).toBe(in90);
    // 90-day count exists only in the tool result: the selection carries the last 30 days.
    expect(r.grounding?.unmatched).toEqual([]);
  });

  it('flags a figure that neither the selection nor a tool returned', async () => {
    const model = await mockModel(n => (n === 0 ? toolCall('get_workouts', { days: 90 }) : said(ANSWER('You logged 977 workouts in the last 90 days.'))));
    const r = await askAnalyst({ query: 'How many workouts?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(r.grounding?.unmatched.length).toBeGreaterThan(0);
  });
});
