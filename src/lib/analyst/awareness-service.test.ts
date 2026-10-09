// ── What the model is told about the app, end to end (design §5) ─────────────
//
// The service with a mock model: the coverage index in both context modes and with
// tools off, the selection labelled, the capability map in the system prompt, the
// routing of a configured provider, and the privacy hook on the fixed selection.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../adapters/dataset';
import { askAnalyst } from './service';
import { installTestDataset } from './capabilities/test-dataset.fake';
import { GENERAL_HANDLER_ID } from './retrieval';
import type { PrivacyPolicy } from './capabilities/types';
import type { LabContextSnapshot } from './types';

const servers: Server[] = [];
beforeEach(() => void installTestDataset());
afterEach(async () => {
  resetToDemoDataset();
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

type Body = { tools?: unknown[]; messages: { content: string }[] };
async function mockModel() {
  const bodies: Body[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      const content = JSON.stringify({ title: 'T', analysis: 'Nothing to fetch.', recommendations: [], summary: [], uncertainty: [], evidence: [], followUps: [] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

const env = (url: string, extra: Record<string, string> = {}) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: '***', ANALYST_CONTEXT: 'full', VITAL_DATA_MODE: 'demo', ...extra }) as unknown as NodeJS.ProcessEnv;
const noMeds = async () => null;
const noLabs = async () => null;
const userOf = (b: Body) => b.messages.at(-1)!.content;
const systemOf = (b: Body) => b.messages[0]!.content;

describe('the coverage index reaches the model in every mode', () => {
  it('full mode: before the selection, with the starting-selection label and the tools wording', async () => {
    const model = await mockModel();
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    const user = userOf(model.bodies[0]!);
    expect(user.indexOf('CAPABILITIES — id')).toBeGreaterThan(-1);
    expect(user.indexOf('CAPABILITIES — id')).toBeLessThan(user.indexOf('"selection"'));
    expect(user).toContain('workouts.sessions · ');
    expect(user).toContain('"complete":false');
    expect(user).toContain('fetch it with the tools');
  });

  it('ondemand mode: the index and no selection', async () => {
    const model = await mockModel();
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url, { ANALYST_CONTEXT: 'ondemand' }), medicationLoader: noMeds, labLoader: noLabs });
    const user = userOf(model.bodies[0]!);
    expect(user).toContain('workouts.sessions · ');
    expect(user).not.toContain('"selection"');
  });

  it('tools off: the index and the selection, with the wording that says nothing more can be fetched', async () => {
    const model = await mockModel();
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url, { ANALYST_TOOLS: 'off' }), medicationLoader: noMeds, labLoader: noLabs });
    const body = model.bodies[0]!;
    expect(body.tools).toBeUndefined();
    const user = userOf(body);
    expect(user.indexOf('workouts.sessions · ')).toBeGreaterThan(-1);
    expect(user.indexOf('workouts.sessions · ')).toBeLessThan(user.indexOf('"selection"'));
    expect(user).toContain('You cannot fetch more in this answer.');
    expect(user).not.toContain('fetch it with the tools');
    expect(systemOf(body)).not.toContain('WHAT THE APP HOLDS');
  });
});

describe('the capability map', () => {
  it('is in the system prompt whenever tools are offered', async () => {
    const model = await mockModel();
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    const system = systemOf(model.bodies[0]!);
    expect(system).toContain('WHAT THE APP HOLDS');
    expect(system).toContain('list_capabilities');
    expect(system).toContain('sleep.nights — Sleep nights');
  });
});

describe('routing for a configured provider (design §5.4)', () => {
  it('never uses a handler\'s narrower selection, even for the handler\'s own question', async () => {
    const model = await mockModel();
    const r = await askAnalyst({ query: 'Is more sleep associated with higher HRV?' }, { env: env(model.url), medicationLoader: noMeds, labLoader: noLabs });
    expect(r.handlerId).toBe(GENERAL_HANDLER_ID);
  });

  it('keeps the demo analyst on its handler, under the new wording and the old one', async () => {
    const demo = { ANALYST_PROVIDER: 'demo' } as unknown as NodeJS.ProcessEnv;
    expect((await askAnalyst({ query: 'Is more sleep associated with higher HRV?' }, { env: demo })).handlerId).toBe('sleep-vs-recovery');
    expect((await askAnalyst({ query: 'Are my workouts associated with better sleep?' }, { env: demo })).handlerId).toBe('sleep-vs-recovery');
  });

  it('reads the lab block in analyte mode for a lab question and in overview mode otherwise', async () => {
    const modes: string[] = [];
    const labLoader = async (_q: string, spec: { mode: string } | null) => (modes.push(spec?.mode ?? 'none'), null as LabContextSnapshot | null);
    const model = await mockModel();
    await askAnalyst({ query: 'What do my lab results show?' }, { env: env(model.url), medicationLoader: noMeds, labLoader });
    await askAnalyst({ query: 'How was my week?' }, { env: env(model.url), medicationLoader: noMeds, labLoader });
    expect(modes).toEqual(['analyte', 'overview']);
  });
});

describe('the privacy hook on the fixed selection (design §9.2)', () => {
  const policy: PrivacyPolicy = { allows: c => c !== 'workouts' && c !== 'lab-results' && c !== 'medication-records' };

  it('keeps withheld categories out of the selection, unread, and says so in the index', async () => {
    const model = await mockModel();
    let labReads = 0;
    let medReads = 0;
    await askAnalyst(
      { query: 'How was my week?' },
      { env: env(model.url), policy, labLoader: async () => (labReads++, null), medicationLoader: async () => (medReads++, null) }
    );
    expect([labReads, medReads]).toEqual([0, 0]);
    const user = userOf(model.bodies[0]!);
    expect(user).toContain('"workouts":null');
    expect(user).toContain('workouts.sessions · withheld by the AI privacy setting');
    expect(user).toContain('LAB RESULTS — withheld by the AI privacy setting');
    expect(user).not.toContain('the workout roll-up');
  });

  it('refuses a tool call for a withheld category', async () => {
    const model = await mockModel();
    // The tool loop is covered by policy.test.ts; here the context a tool call would get must carry the policy.
    const { capabilityContext } = await import('./tools/capability-tool');
    const { createDataAccess } = await import('./dataAccess');
    const access = createDataAccess({ system: 'metric', refKey: '2026-10-08', policy });
    const cctx = capabilityContext({ system: 'metric', deps: {}, changes: [], data: access });
    expect('policy' in cctx && cctx.policy.allows('workouts')).toBe(false);
    expect(model.bodies).toHaveLength(0);
  });
});
