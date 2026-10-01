import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_KEY } from '../adapters/dataset';
import { startFromReference } from '../routine/actions';
import { FilePlanRepository } from '../routine/store';
import { resolvePageContext } from './page-context';
import { parsePageContextRef } from './page-context-types';
import { retrieveGeneral } from './retrieval';
import { askAnalyst } from './service';
import { buildAnalystUserMessage, UNTRUSTED_END, UNTRUSTED_START } from './systemPrompt';

const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;

let dir: string;
let repo: FilePlanRepository;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vital-page-context-'));
  repo = new FilePlanRepository(join(dir, 'plans.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = () => ({ env: DEMO, repo });
const withPlan = () => startFromReference('calisthenics', { source: 'user', summary: 'setup' }, deps());

describe('parsePageContextRef', () => {
  it('accepts each page kind and nothing else', () => {
    expect(parsePageContextRef({ kind: 'routine' })).toEqual({ kind: 'routine' });
    expect(parsePageContextRef({ kind: 'routine-path', pathId: 'horizontal-push' })).toEqual({ kind: 'routine-path', pathId: 'horizontal-push' });
    expect(parsePageContextRef({ kind: 'routine-workout', templateId: 'a' })).toEqual({ kind: 'routine-workout', templateId: 'a' });
    expect(parsePageContextRef({ kind: 'routine-untracked', name: ' Dips ' })).toEqual({ kind: 'routine-untracked', name: 'Dips' });
    for (const bad of [null, undefined, 'routine', [], {}, { kind: 'metric' }, { kind: 'routine-path' }, { kind: 'routine-path', pathId: 3 }, { kind: 'routine-path', pathId: '  ' }]) {
      expect(parsePageContextRef(bad)).toBeNull();
    }
  });

  it('refuses over-long ids and strips control characters', () => {
    expect(parsePageContextRef({ kind: 'routine-path', pathId: 'x'.repeat(121) })).toBeNull();
    expect(parsePageContextRef({ kind: 'routine-untracked', name: 'Dips\n\u0000' })).toEqual({ kind: 'routine-untracked', name: 'Dips' });
  });
});

describe('resolvePageContext', () => {
  it('is null without an active plan', async () => {
    expect(await resolvePageContext({ kind: 'routine' }, 'metric', deps())).toBeNull();
  });

  it('describes the plan, and a path with its history', async () => {
    await withPlan();
    const overview = await resolvePageContext({ kind: 'routine' }, 'metric', deps());
    expect(overview?.label).toMatch(/^the overview of the training plan "/);
    expect(JSON.parse(overview!.json).routine.paths.length).toBeGreaterThan(1);

    const path = await resolvePageContext({ kind: 'routine-path', pathId: 'horizontal-push' }, 'metric', deps());
    expect(path?.label).toContain('pathId "horizontal-push"');
    const parsed = JSON.parse(path!.json);
    expect(parsed.openPathId).toBe('horizontal-push');
    expect(path!.json).toContain('Decline push-up 12/12/10');
  });

  it('resolves a workout by template id', async () => {
    const { change } = await withPlan();
    const stored = await repo.get(change.planId);
    const templateId = stored!.plan.templates[0].id;
    const workout = await resolvePageContext({ kind: 'routine-workout', templateId }, 'metric', deps());
    expect(workout?.label).toContain(`templateId "${templateId}"`);
    expect(JSON.parse(workout!.json).workout.id).toBe(templateId);
  });

  it('is null for a path, workout or exercise the plan does not have', async () => {
    await withPlan();
    expect(await resolvePageContext({ kind: 'routine-path', pathId: 'nope' }, 'metric', deps())).toBeNull();
    expect(await resolvePageContext({ kind: 'routine-workout', templateId: 'nope' }, 'metric', deps())).toBeNull();
    expect(await resolvePageContext({ kind: 'routine-untracked', name: 'Not an exercise' }, 'metric', deps())).toBeNull();
  });
});

describe('the page context in the model message', () => {
  const bundle = retrieveGeneral(REFERENCE_KEY);

  it('travels inside the untrusted delimiters, before the question', () => {
    const message = buildAnalystUserMessage({
      question: 'Am I ready for the next stage?',
      bundle,
      system: 'metric',
      pageContext: { label: 'the page for the Push path', json: '{"openPathId":"push"}' },
    });
    const at = message.indexOf('{"openPathId":"push"}');
    expect(message).toContain('The reader asked this from the page for the Push path.');
    expect(message.lastIndexOf(UNTRUSTED_START, at)).toBeGreaterThan(-1);
    expect(message.indexOf(UNTRUSTED_END, at)).toBeGreaterThan(at);
    expect(at).toBeLessThan(message.indexOf('Question: Am I ready'));
  });

  it('is left out when there is none', () => {
    const message = buildAnalystUserMessage({ question: 'How is my sleep?', bundle, system: 'metric' });
    expect(message).not.toContain('The reader asked this from');
  });
});

// ── End to end through the service, with a mock model ───

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

/** A model that answers at once, without tools, quoting the path's latest session. */
async function answeringModel() {
  const bodies: Record<string, unknown>[] = [];
  const answer = JSON.stringify({
    title: 'Horizontal push',
    observed: ['The latest decline push-up session was 12/12/10, 34 reps.'],
    interpretation: ['Reps sit near the top of the range.'],
    uncertainty: ['Form is not recorded.'],
    evidence: [],
    followUps: ['How is my sleep trending?'],
  });
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content: answer } }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { env: { ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: 'sk-test' } as unknown as NodeJS.ProcessEnv, bodies };
}

describe('askAnalyst with a page context', () => {
  it('sends the page state to the model and grounds numbers quoted from it', async () => {
    await withPlan();
    const model = await answeringModel();
    const response = await askAnalyst(
      { query: 'How is this going?', context: { kind: 'routine-path', pathId: 'horizontal-push' } },
      { env: model.env, routine: deps() }
    );
    expect(response.status).toBe('ok');
    expect(response.grounding.unmatched).toEqual([]);
    const sent = JSON.stringify(model.bodies[0]);
    expect(sent).toContain('pathId \\"horizontal-push\\"');
    expect(sent).toContain('Decline push-up 12/12/10');
  });

  it('sends no page state when the question names no page', async () => {
    await withPlan();
    const model = await answeringModel();
    const response = await askAnalyst({ query: 'How is this going?' }, { env: model.env, routine: deps() });
    expect(response.status).toBe('ok');
    expect(JSON.stringify(model.bodies[0])).not.toContain('The reader asked this from');
  });

  it('still answers when the page no longer resolves', async () => {
    await withPlan();
    const model = await answeringModel();
    const response = await askAnalyst(
      { query: 'How is this going?', context: { kind: 'routine-path', pathId: 'removed-path' } },
      { env: model.env, routine: deps() }
    );
    expect(response.status).toBe('ok');
    expect(JSON.stringify(model.bodies[0])).not.toContain('The reader asked this from');
  });
});
