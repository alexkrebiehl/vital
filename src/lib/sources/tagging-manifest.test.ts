// ── Tool tagging is derived from the capability manifest ────────────────────
//
// design §9.1 / §13: a new capability's tool is classified by the `sources` tag of
// its manifest entry, so a removed source still deletes every conversation the
// capability fed. The behaviour for the tool names that existed before is pinned in
// tagging.test.ts and again here.

import { describe, expect, it } from 'vitest';
import type { ProvenanceRow } from '@/lib/adapters/normalize';
import { CAPABILITY_MANIFEST } from '@/lib/analyst/capabilities/manifest';
import type { AnalystResponse } from '@/lib/analyst/types';
import { ANALYST_TOOLS } from '@/lib/analyst/tools';
import { deriveToolSets, PLAN_WRITE_TOOLS, sourceIdsForTurn, toolTag, type TurnSources } from '@/lib/sources/tagging';

const SOURCES: TurnSources = { provenance: [] as ProvenanceRow[], activeIds: ['hae', 'hevy', 'lab', 'oura'], activeHealthIds: ['hae', 'oura'] };

const turn = (tools: string[]): Pick<AnalystResponse, 'handlerId' | 'status' | 'retrieval' | 'toolsUsed'> => ({
  handlerId: 'general',
  status: 'ok',
  retrieval: { recordsRead: 0, note: 'Selected context.', metrics: [] },
  toolsUsed: tools,
});
const tagged = (tools: string[]) => sourceIdsForTurn(turn(tools), SOURCES);

const MANIFEST_TOOLS = [...new Set(CAPABILITY_MANIFEST.map(e => e.tool))];

describe('every manifest tool is classified', () => {
  it.each(MANIFEST_TOOLS)('%s has a tag', tool => {
    expect(toolTag(tool), `${tool} is in the manifest but tagging does not classify it`).toBeDefined();
  });

  it('classifies a tool by the sources tag of every manifest entry that names it', () => {
    for (const e of CAPABILITY_MANIFEST) expect(toolTag(e.tool), e.id).toBe(e.sources);
  });

  it('gives a tool shared by two capabilities one tag', () => {
    const byTool = new Map<string, Set<string>>();
    for (const e of CAPABILITY_MANIFEST) byTool.set(e.tool, (byTool.get(e.tool) ?? new Set()).add(e.sources));
    for (const [tool, tags] of byTool) expect(tags.size, tool).toBe(1);
  });

  it('tags a turn that used only manifest tools with at least one active source', () => {
    for (const tool of MANIFEST_TOOLS) expect(tagged([tool]).length, tool).toBeGreaterThan(0);
  });

  it('classifies the plan write tools, which are not capabilities, and only them', () => {
    const writers = ANALYST_TOOLS.filter(t => t.kind === 'write').map(t => t.name);
    expect([...PLAN_WRITE_TOOLS].sort()).toEqual([...writers].sort());
    for (const w of writers) expect(toolTag(w)).toBe('plan-write');
    expect(toolTag('a_tool_nobody_wrote')).toBeUndefined();
  });
});

describe('deriveToolSets', () => {
  const entries = [
    { tool: 'a_lab', sources: 'lab' as const },
    { tool: 'a_hae', sources: 'hae' as const },
    { tool: 'a_health', sources: 'all-health' as const },
    { tool: 'a_detail', sources: 'workout-detail' as const },
    { tool: 'a_metric', sources: 'metric-provenance' as const },
    { tool: 'a_config', sources: 'configuration' as const },
  ];

  it('sorts each tool into the set of its tag', () => {
    const sets = deriveToolSets(entries);
    expect([...sets.lab]).toEqual(['a_lab']);
    expect([...sets.hae]).toEqual(['a_hae']);
    expect([...sets.allHealth]).toEqual(['a_health']);
    expect([...sets.configuration].sort()).toEqual(['a_config', ...PLAN_WRITE_TOOLS].sort());
    expect([...sets.opaque].sort()).toEqual(['a_detail', 'a_metric']);
  });

  it('is what tags a tool a capability adds later, with no change to tagging.ts', () => {
    const sets = deriveToolSets([...entries, { tool: 'get_new_lab_thing', sources: 'lab' }]);
    expect(sets.lab.has('get_new_lab_thing')).toBe(true);
  });
});

describe('the tool names that existed before are tagged as they were', () => {
  it.each([
    [['get_lab_results'], ['lab']],
    [['compare_lab_panels'], ['lab']],
    [['get_medications'], ['hae']],
    [['get_workouts'], ['hae', 'oura']],
    [['get_lab_results', 'get_medications'], ['hae', 'lab']],
    [['get_lab_results', 'get_workouts'], ['hae', 'lab', 'oura']],
  ])('%j → %j', (tools, ids) => {
    expect(tagged(tools)).toEqual(ids);
  });

  it.each(['get_metric_series', 'get_metric_relationship', 'get_sleep', 'get_blood_pressure', 'get_routine_progress', 'get_training_sessions'])(
    '%s reads what the turn does not list, so it is tagged with every active source',
    tool => {
      expect(tagged([tool])).toEqual(['hae', 'hevy', 'lab', 'oura']);
      expect(tagged([tool, 'get_medications'])).toEqual(['hae', 'hevy', 'lab', 'oura']);
    }
  );

  // get_metrics and compare_periods are retired, but a stored conversation still lists them.
  it.each(['get_metrics', 'compare_periods'])('%s, a retired tool in a stored turn, is read as opaque: tagged with every active source', tool => {
    expect(tagged([tool])).toEqual(['hae', 'hevy', 'lab', 'oura']);
  });

  it.each(['get_training_plan', 'get_reference_plan', 'search_exercise_templates', 'create_training_plan', 'update_training_plan', 'set_current_stage', 'set_path_hold', 'clear_path_hold', 'record_deload', 'archive_training_plan'])(
    '%s reads or writes configuration, so it adds no source on its own',
    tool => {
      expect(tagged([tool, 'get_medications'])).toEqual(['hae']);
      expect(tagged([tool])).toEqual(['hae', 'hevy', 'lab', 'oura']);
    }
  );

  it('still treats an unknown tool as opaque', () => {
    expect(tagged(['get_something_new', 'get_medications'])).toEqual(['hae', 'hevy', 'lab', 'oura']);
  });
});
