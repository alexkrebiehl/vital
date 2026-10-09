// ── list_capabilities (design §4.3) ──────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { runTool, toolSpecs, availableTools } from '../tools';
import { DATA_TOOLS } from '../tools/data';
import { DATA_TOOL_NAMES } from '../tools/names';
import { CAPABILITIES } from './registry';
import { assertNumberRule } from './number-rule';
import { installTestDataset } from './test-dataset.fake';
import { testCtx } from './test-context.fake';
import type { PrivacyPolicy } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

function toolCtx(over: Parameters<typeof testCtx>[0] = {}) {
  const c = testCtx(over);
  return { system: 'metric' as const, deps: c.routine, changes: [], data: { ...c.access, policy: c.policy } };
}
const call = async (args: Record<string, unknown>, ctx = toolCtx()) => {
  const r = await runTool('list_capabilities', args, ctx);
  return { ...r, json: JSON.parse(r.content) };
};

describe('list_capabilities is a data tool', () => {
  it('is named, and offered with the others', () => {
    expect(DATA_TOOL_NAMES).toContain('list_capabilities');
    expect(availableTools({ data: toolCtx().data }).map(t => t.name)).toContain('list_capabilities');
    expect(availableTools({}).map(t => t.name)).not.toContain('list_capabilities');
  });

  it('keeps the data tool specs within 12,000 characters together', () => {
    expect(JSON.stringify(toolSpecs(DATA_TOOLS)).length).toBeLessThanOrEqual(12_000);
  });
});

describe('list_capabilities without arguments', () => {
  it('gives one entry per capability with its tool, phrase and live coverage', async () => {
    const r = await call({});
    expect(r.isError).toBe(false);
    const list = r.json.capabilities as { id: string; title: string; tool: string; holds: string; coverage: string }[];
    expect(list.map(c => c.id)).toEqual(CAPABILITIES.map(c => c.id));
    const workouts = list.find(c => c.id === 'workouts.sessions')!;
    expect(workouts.tool).toBe('get_workouts');
    expect(workouts.coverage).toMatch(/^\d{4}-\d\d-\d\d\.\.\d{4}-\d\d-\d\d · 420 sessions$/);
  });

  it('says unknown, not zero, for the upstream-only capability', async () => {
    const list = (await call({})).json.capabilities as { id: string; coverage: string }[];
    expect(list.find(c => c.id === 'medications.doses')!.coverage).toBe('unknown — fetch to see');
  });

  it('obeys the number rule, and holds no secret', async () => {
    const r = await call({});
    assertNumberRule(r.json);
    expect(r.content).not.toMatch(/https?:\/\//);
  });
});

describe('list_capabilities with an area', () => {
  it('lists only that area', async () => {
    const list = (await call({ area: 'sleep' })).json.capabilities as { id: string }[];
    expect(list.map(c => c.id)).toEqual(['sleep.nights', 'sleep.summary']);
  });

  it('refuses an unknown area, naming the areas', async () => {
    const r = await call({ area: 'cardio' });
    expect(r.isError).toBe(true);
    expect(r.json.status).toBe('invalid_args');
    expect(r.json.next).toContain('sleep');
  });
});

describe('list_capabilities with an id', () => {
  it('gives the full parameters and example calls the tool accepts', async () => {
    const r = await call({ id: 'workouts.sessions' });
    expect(r.isError).toBe(false);
    const cap = r.json.capability;
    expect(cap.id).toBe('workouts.sessions');
    expect(cap.description).toBe(CAPABILITIES.find(c => c.id === 'workouts.sessions')!.description);
    expect(cap.parameters).toContain('window (object)');
    expect(cap.examples).toHaveLength(2);
    expect(cap.examples[0]).toMatch(/^get_workouts \{/);
  });

  it('shows a get_app_data capability\'s own parameters and calls', async () => {
    const cap = (await call({ id: 'insights.reports' })).json.capability;
    expect(cap.parameters).toContain('kind (one of weekly, monthly, required)');
    expect(cap.examples[0]).toBe('get_app_data {"capability":"insights.reports","params":{"kind":"weekly","count":4}}');
  });

  it('refuses an unknown id with a suggestion', async () => {
    const r = await call({ id: 'workout.sessions' });
    expect(r.isError).toBe(true);
    expect(r.json.next).toContain('workouts.sessions');
  });
});

describe('list_capabilities under a privacy policy', () => {
  it('marks a withheld capability as withheld, with no count', async () => {
    const policy: PrivacyPolicy = { allows: c => c !== 'workouts' };
    const list = (await call({}, toolCtx({ policy }))).json.capabilities as { id: string; coverage: string }[];
    expect(list.find(c => c.id === 'workouts.sessions')!.coverage).toBe('withheld by the AI privacy setting');
  });
});
