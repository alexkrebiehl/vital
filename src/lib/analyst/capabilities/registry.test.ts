// ── The capability registry ─────────────────────────────
//
// What this pins: the manifest (client-safe) and the registry (server) describe
// the same capabilities and the same tools; every tool named exists; the twelve
// plan tools are exactly as they were; a read goes through the existing tool
// unchanged and through the privacy policy first.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDataAccess } from '../dataAccess';
import { ANALYST_TOOLS, availableTools } from '../tools';
import { DATA_TOOLS } from '../tools/data';
import { DATA_TOOL_NAMES } from '../tools/names';
import type { LabSourceInput } from '../labSnapshot';
import { CAPABILITY_MANIFEST } from './manifest';
import { CAPABILITIES, capabilitiesForTool, capabilityById } from './registry';
import { ALLOW_ALL, type CapabilityContext, type PrivacyPolicy } from './types';

const DEMO = { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv;
const REF = '2026-09-17';

const NO_LABS: LabSourceInput = { available: true, reason: null, documents: 0, totalObservations: 0, collisions: 0, series: [] };

function fakeAccess(lab: LabSourceInput = NO_LABS) {
  return createDataAccess({
    system: 'metric',
    refKey: REF,
    env: DEMO,
    labSource: async () => lab,
    medications: async days => ({
      available: true,
      reason: null,
      referenceDay: REF,
      lookbackDays: days,
      windowFrom: null,
      windowTo: null,
      readAt: null,
      totalRecords: 0,
      totalMedications: 0,
      undatedRecords: 0,
      skippedRecords: 0,
      medications: [],
      note: `last ${days} days`,
      completeness: 'what was logged',
      kind: 'record',
    }),
  });
}

function ctxFor(over: Partial<CapabilityContext> = {}): CapabilityContext {
  return { system: 'metric', refKey: REF, tz: 'America/Chicago', env: DEMO, access: fakeAccess(), routine: { env: DEMO }, policy: ALLOW_ALL, ...over };
}

const EXPECTED: [id: string, tool: string][] = [
  ['metrics.summary', 'get_metrics'],
  ['metrics.compare', 'compare_periods'],
  ['metrics.series', 'get_metric_series'],
  ['metrics.relationship', 'get_metric_relationship'],
  ['workouts.sessions', 'get_workouts'],
  ['workouts.summary', 'get_workouts'],
  ['sleep.nights', 'get_sleep'],
  ['sleep.summary', 'get_sleep'],
  ['heart.blood_pressure', 'get_blood_pressure'],
  ['labs.series', 'get_lab_results'],
  ['labs.compare', 'compare_lab_panels'],
  ['medications.summary', 'get_medications'],
  ['medications.doses', 'get_medications'],
  ['training.progress', 'get_routine_progress'],
  ['training.plan', 'get_training_plan'],
  ['training.sessions', 'get_training_sessions'],
  ['training.exercise_templates', 'search_exercise_templates'],
  ['training.reference_plans', 'get_reference_plan'],
  ['labs.documents', 'get_app_data'],
  ['body.goal', 'get_app_data'],
  ['body.nutrition_adherence', 'get_app_data'],
  ['insights.current', 'get_app_data'],
  ['insights.reports', 'get_app_data'],
  ['activity.coverage', 'get_app_data'],
  ['activity.maps', 'get_app_data'],
  ['app.data_quality', 'get_app_data'],
  ['app.pipeline', 'get_app_data'],
  ['app.profile', 'get_app_data'],
  ['app.preferences', 'get_app_data'],
  ['app.briefing', 'get_app_data'],
  ['app.dashboard', 'get_app_data'],
  ['training.workout_template', 'get_app_data'],
];

describe('manifest and registry', () => {
  it('list the capabilities served today, in the same order, with the same tools', () => {
    expect(CAPABILITY_MANIFEST.map(e => [e.id, e.tool])).toEqual(EXPECTED);
    expect(CAPABILITIES.map(c => [c.id, c.tool])).toEqual(EXPECTED);
  });

  it('agree entry by entry on everything the manifest carries', () => {
    for (const entry of CAPABILITY_MANIFEST) {
      const cap = capabilityById(entry.id);
      expect(cap, entry.id).toBeDefined();
      expect({ ...entry }).toEqual(Object.fromEntries(Object.keys(entry).map(k => [k, (cap as unknown as Record<string, unknown>)[k]])));
    }
  });

  it('have unique ids', () => {
    expect(new Set(CAPABILITIES.map(c => c.id)).size).toBe(CAPABILITIES.length);
  });

  it('name only tools that exist in the offered set', () => {
    const offered = availableTools({ data: fakeAccess() }).map(t => t.name);
    for (const entry of CAPABILITY_MANIFEST) expect(offered, entry.id).toContain(entry.tool);
  });

  it('give the seven data tools the status line the client shows today, verbatim', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/analyst/AnswerView.tsx'), 'utf8');
    const block = /const DATA_LOOKUPS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? '';
    const lookups = Object.fromEntries([...block.matchAll(/(\w+):\s*'([^']*)'/g)].map(m => [m[1], m[2]]));
    expect(Object.keys(lookups).sort()).toEqual([...DATA_TOOL_NAMES].sort());
    for (const entry of CAPABILITY_MANIFEST.filter(e => (DATA_TOOL_NAMES as readonly string[]).includes(e.tool))) {
      expect(entry.statusLabel, entry.tool).toBe(lookups[entry.tool]);
    }
  });

  it('give each plan read tool the status line the client derives for it', () => {
    for (const entry of CAPABILITY_MANIFEST.filter(e => e.area === 'training' && e.tool !== 'get_app_data')) {
      expect(entry.statusLabel).toBe(`Using the plan tool: ${entry.tool.replace(/_/g, ' ')}…`);
    }
  });

  it('finds capabilities by tool', () => {
    expect(capabilitiesForTool('get_workouts').map(c => c.id)).toEqual(['workouts.sessions', 'workouts.summary']);
    expect(capabilitiesForTool('get_sleep').map(c => c.id)).toEqual(['sleep.nights', 'sleep.summary']);
    expect(capabilitiesForTool('get_nothing')).toEqual([]);
    expect(capabilityById('labs.series')?.tool).toBe('get_lab_results');
    expect(capabilityById('nope')).toBeUndefined();
  });
});

describe('manifest.ts', () => {
  it('imports nothing but ./types, so the client can use it', () => {
    const src = fs.readFileSync(path.join(__dirname, 'manifest.ts'), 'utf8');
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['./types']));
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
  });
});

describe('the plan tools', () => {
  it('are the same twelve, with the same kinds', () => {
    expect(ANALYST_TOOLS.map(t => `${t.name}:${t.kind}`)).toEqual([
      'get_routine_progress:read',
      'get_training_plan:read',
      'get_training_sessions:read',
      'search_exercise_templates:read',
      'get_reference_plan:read',
      'create_training_plan:write',
      'update_training_plan:write',
      'set_current_stage:write',
      'set_path_hold:write',
      'clear_path_hold:write',
      'record_deload:write',
      'archive_training_plan:write',
    ]);
  });

  it('are registered only as reads', () => {
    const plan = new Map(ANALYST_TOOLS.map(t => [t.name, t.kind]));
    for (const cap of CAPABILITIES) expect(DATA_TOOLS.some(t => t.name === cap.tool) || plan.get(cap.tool) === 'read', cap.id).toBe(true);
  });
});

describe('a capability read', () => {
  it('returns what the tool returns: the ok envelope itself', async () => {
    const tool = DATA_TOOLS.find(t => t.name === 'get_workouts')!;
    const ctx = ctxFor();
    const direct = await tool.run({ days: 30 }, { system: 'metric', deps: ctx.routine, changes: [], data: ctx.access });
    const env = await capabilityById('workouts.sessions')!.read({ days: 30 }, ctx);
    expect(env.status).toBe('ok');
    expect(env.capability).toBe('workouts.sessions');
    expect(env).toEqual(direct.content);
  });

  it('reports bad arguments as invalid_args with the checker\'s problems', async () => {
    const env = await capabilityById('workouts.sessions')!.read({ days: 'many' }, ctxFor());
    expect(env.status).toBe('invalid_args');
    expect(env.problems?.[0]).toMatch(/days must be a whole number/);
  });

  it('answers privacy_blocked before reading when the policy withholds the category', async () => {
    const cap = capabilityById('workouts.summary')!;
    const denied: string[] = [];
    const policy: PrivacyPolicy = { allows: c => (denied.push(c), false) };
    const ctx = ctxFor({ policy });
    const env = await cap.read({ days: 30 }, ctx);
    expect(env.status).toBe('privacy_blocked');
    expect(denied).toEqual([cap.category]);
    expect(ctx.access.fetched.workouts).toBeNull();
  });

  it('reports an unreadable lab source as source_unavailable, never as none', async () => {
    const down: LabSourceInput = { available: false, reason: 'No Postgres database is configured.', documents: 0, totalObservations: 0, collisions: 0, series: [] };
    const env = await capabilityById('labs.series')!.read({ analytes: ['ldl'] }, ctxFor({ access: fakeAccess(down) }));
    expect(env.status).toBe('source_unavailable');
    expect(env.next).toMatch(/could not be read: No Postgres database is configured\. This says nothing about whether records exist\./);
  });

  it('reports a thrown reader error as source_unavailable with the text scrubbed', async () => {
    const access = createDataAccess({ system: 'metric', refKey: REF, env: DEMO, medicationLog: async () => { throw new Error('boom https://u:secretpw@host.example/x'); } });
    const env = await capabilityById('medications.summary')!.read({}, ctxFor({ access }));
    expect(env.status).toBe('source_unavailable');
    expect(JSON.stringify(env)).not.toMatch(/secretpw/);
  });
});

describe('coverage', () => {
  it('is known for workouts from the installed dataset', async () => {
    const c = await capabilityById('workouts.summary')!.coverage(ctxFor());
    expect(c.kind).toBe('known');
    if (c.kind === 'known') {
      expect(c.count).toBeGreaterThan(0);
      expect(c.first! <= c.last!).toBe(true);
      expect(c.unit).toBe('sessions');
    }
  });

  it('is known for metrics from the installed dataset', async () => {
    const c = await capabilityById('metrics.summary')!.coverage(ctxFor());
    expect(c).toMatchObject({ kind: 'known', unit: 'metrics' });
    if (c.kind === 'known') expect(c.count).toBeGreaterThan(0);
  });

  it('comes from the lab source for labs, and says "unavailable" when it cannot be read', async () => {
    expect(await capabilityById('labs.series')!.coverage(ctxFor())).toEqual({ kind: 'known', first: null, last: null, count: 0, unit: 'results' });
    const down: LabSourceInput = { available: false, reason: 'No Postgres database is configured.', documents: 0, totalObservations: 0, collisions: 0, series: [] };
    expect(await capabilityById('labs.series')!.coverage(ctxFor({ access: fakeAccess(down) }))).toEqual({ kind: 'unavailable', reason: 'No Postgres database is configured.' });
  });

  it('is unknown for medications, which only the upstream can tell', async () => {
    const c = await capabilityById('medications.summary')!.coverage(ctxFor());
    expect(c.kind).toBe('unknown');
  });
});
