// ── The secret canary (design §9.1) ─────────────────────────────────────────
//
// Every credential variable the app reads has a distinct canary value, and each
// stored source credential another. Every capability is run, directly and through
// the tool the model calls, against sources that work, that throw, and that report
// themselves unavailable, with failure messages that carry the canaries. A canary
// that shows up in any result, `next`, `problems`, coverage or thrown message is a
// leak. Nothing here reads a health source, the database or a model.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { FilePlanRepository } from '../../routine/store';
import { isCredentialName } from '../scrub';
import type { TrainingData } from '../../workout-sources/store';
import { runTool } from '../tools';
import { CAPABILITIES } from './registry';
import { installTestDataset } from './test-dataset.fake';
import { ARGS, ctxFor, toolArgs, type Canaries, type Mode } from './privacy.fake';
import type { CapabilityContext } from './types';

// The variables of design §9.1, a distinct canary for each, and a stored credential per source.
const C = vi.hoisted(() => {
  const names = ['HAE_API_KEY', 'HAE_TOKEN', 'HEVY_API_KEY', 'OURA_CLIENT_SECRET', 'OURA_SECRET', 'VITAL_SECRET_KEY', 'ANALYST_API_KEY', 'VITAL_LLM_API_KEY', 'VITAL_LLM_FALLBACK_API_KEY', 'VITAL_PG_PASSWORD', 'MAP_TILES_CARTO_KEY'];
  const envCanaries: Record<string, string> = Object.fromEntries(names.map((n, i) => [n, `canary-${n.toLowerCase().replace(/_/g, '-')}-${String(i).padStart(2, '0')}`]));
  const stored = { hae: 'canary-stored-hae-secret-7a1', hevy: 'canary-stored-hevy-secret-7a2', oura: 'canary-stored-oura-secret-7a3' };
  // A bare value, a header, a bearer token and a URL with userinfo: the shapes a failing request echoes.
  const leaky = `request failed (${Object.values(envCanaries).join(' ')}) x-api-key: ${stored.hevy} Authorization: Bearer ${stored.hae} via https://user:${stored.oura}@meds.internal.example.com/v1/medications`;
  return { names, envCanaries, stored, leaky, all: [...Object.values(envCanaries), ...Object.values(stored)], env: { VITAL_DATA_MODE: 'demo', ...envCanaries } as unknown as NodeJS.ProcessEnv };
});
const CANARIES: Canaries = { env: C.env, leaky: C.leaky };
const ALL_CANARIES = C.all;
const ENV_CANARIES = C.envCanaries;
const STORED_CANARIES = C.stored;
const LEAKY = C.leaky;
const CANARY_ENV = C.env;

const store = vi.hoisted(() => ({ mode: 'healthy' as string }));
vi.mock('../../workout-sources/store', async importOriginal => {
  const text = C.leaky;
  return {
    ...(await importOriginal<typeof import('../../workout-sources/store')>()),
    loadTrainingData: async (): Promise<TrainingData> => {
      if (store.mode === 'throwing') throw new Error(text);
      const status = { id: 'w', displayName: 'Workouts', configured: true, host: 'strength.internal.example.com', origin: 'live' as const, sessions: 0, lastSyncAt: null, newestSessionAt: null, lastError: store.mode === 'unavailable' ? text : null };
      return { origin: 'demo', sessions: [], statuses: [status] };
    },
  };
});

let data: ReturnType<typeof installTestDataset>;
let dir: string;
beforeEach(() => {
  data = installTestDataset();
  dir = mkdtempSync(join(tmpdir(), 'vital-canary-'));
  // The credentials live in the process environment in production; the scrubber reads them there.
  for (const [name, value] of Object.entries(ENV_CANARIES)) vi.stubEnv(name, value);
});
afterEach(() => {
  resetToDemoDataset();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const routine = () => ({
  env: CANARY_ENV,
  repo: new FilePlanRepository(join(dir, 'plans.json')),
  fetchImpl: (async () => {
    throw new Error(LEAKY);
  }) as unknown as typeof fetch,
});

const MODES: Mode[] = ['healthy', 'throwing', 'unavailable'];
const leaked = (text: string): string[] => ALL_CANARIES.filter(c => text.includes(c));

/** Everything a read puts in front of the model, or throws, for one capability. */
async function readAll(ctx: CapabilityContext) {
  const out: { id: string; text: string; status?: string }[] = [];
  const thrown: string[] = [];
  for (const cap of CAPABILITIES) {
    try {
      const env = await cap.read(ARGS[cap.id], ctx);
      out.push({ id: cap.id, text: JSON.stringify(env), status: env.status });
    } catch (error) {
      thrown.push(`${cap.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      out.push({ id: `${cap.id} coverage`, text: JSON.stringify(await cap.coverage(ctx)) });
    } catch (error) {
      thrown.push(`${cap.id} coverage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { out, thrown };
}

describe('the canaries', () => {
  it('are distinct, one per credential variable and one per stored source credential', () => {
    expect(Object.keys(ENV_CANARIES)).toHaveLength(11);
    expect(new Set(ALL_CANARIES).size).toBe(ALL_CANARIES.length);
    expect(ALL_CANARIES).toHaveLength(11 + Object.keys(STORED_CANARIES).length);
    for (const c of ALL_CANARIES) expect(c.length).toBeGreaterThanOrEqual(12);
  });

  it('cover every variable the scrubber treats as a credential', () => {
    expect(C.names.filter(n => !isCredentialName(n))).toEqual([]);
    expect(isCredentialName('ANALYST_MAX_TOKENS')).toBe(false);
  });

  it('have a call for every registered capability', () => {
    expect(Object.keys(ARGS).sort()).toEqual(CAPABILITIES.map(c => c.id).sort());
  });
});

describe.each(MODES)('with sources that are %s', mode => {
  beforeEach(() => void (store.mode = mode));

  it('leaks no canary from any capability: result, next, problems, coverage or thrown message', async () => {
    const { out, thrown } = await readAll(ctxFor(mode, data, routine(), CANARIES));
    expect(thrown.filter(t => leaked(t).length)).toEqual([]);
    expect(out.filter(o => leaked(o.text).length).map(o => `${o.id}: ${leaked(o.text).join(',')}`)).toEqual([]);
    const statuses = out.map(o => o.status);
    if (mode === 'healthy') expect(statuses).not.toContain('source_unavailable');
    // The failing sources really were reached: the medication log and the lab store each say so.
    else for (const id of ['labs.series', 'labs.compare', 'medications.summary', 'medications.doses', 'labs.documents', 'body.goal', 'body.nutrition_adherence']) expect(out.find(o => o.id === id)?.status, id).toBe('source_unavailable');
  });

  it('leaks no canary from any tool the model calls', async () => {
    const ctx = ctxFor(mode, data, routine(), CANARIES);
    const seen: string[] = [];
    for (const cap of CAPABILITIES) {
      const r = await runTool(cap.tool, toolArgs(cap), { system: 'metric', deps: ctx.routine, changes: [], data: ctx.access });
      seen.push(r.content);
      expect(leaked(r.content), `${cap.tool} (${cap.id})`).toEqual([]);
    }
    expect(seen.length).toBe(CAPABILITIES.length);
  });
});

describe('the strength source status', () => {
  it('shows its last error to the model scrubbed, not as the source wrote it', async () => {
    store.mode = 'unavailable';
    const ctx = ctxFor('healthy', data, routine(), CANARIES);
    const r = await runTool('get_training_sessions', {}, { system: 'metric', deps: ctx.routine, changes: [], data: ctx.access });
    const sources = (JSON.parse(r.content) as { sources: { error: string | null }[] }).sources;
    expect(sources[0].error).toMatch(/^request failed/);
    expect(leaked(r.content)).toEqual([]);
    expect(r.content).not.toMatch(/meds\.internal\.example\.com|https?:\/\//);
  });
});

describe('a tool that throws', () => {
  it('has the credential values of its own environment removed, even when the process holds none', async () => {
    vi.unstubAllEnvs();
    const ctx = ctxFor('throwing', data, routine(), CANARIES);
    const r = await runTool('get_lab_results', { analytes: ['ldl'] }, { system: 'metric', deps: ctx.routine, changes: [], data: ctx.access });
    expect(r.isError).toBe(true);
    expect(leaked(r.content)).toEqual([]);
  });
});
