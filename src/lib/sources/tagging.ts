// ── Which sources fed an analyst answer (SERVER ONLY) ───────────────────────
//
// Plan §C3. Each assistant turn is stored with the ids of the data sources
// whose data entered its context or tool results, so that removing a source can
// hide and then delete exactly the conversations that came from it.
//
// TAGS ONLY: the result is a list of source ids, never a value. Unknown is not
// guessed down: when the exact set cannot be determined the turn is tagged with
// EVERY active source. Over-tagging only means deleting more on removal; an
// under-tag would leak.
//
// How a turn is attributed:
//   * a metric the turn used           → the sources named in that metric's
//                                         provenance row (rows that kept at
//                                         least one observation);
//   * lab handler / lab block / tool   → `lab`;
//   * medication block / tool          → `hae` (records come from the HAE server);
//   * workouts                         → every active health source;
//   * a generic data tool or anything unrecognised → every active source.
//
// A tool's class comes from the `sources` tag of its capability's manifest entry
// (capabilities/manifest.ts), so a capability added later is classified by adding
// its entry, not by editing this file. tagging-manifest.test.ts fails when a
// manifest tool is not classified.

import type { ProvenanceRow } from '@/lib/adapters/normalize';
import { OURA_SOURCE_NAME } from '@/lib/adapters/oura/normalize';
import { CAPABILITY_MANIFEST } from '@/lib/analyst/capabilities/manifest';
import type { CapabilityManifestEntry, SourceTag } from '@/lib/analyst/capabilities/types';
import type { AnalystResponse } from '@/lib/analyst/types';
import { DATA_SOURCES, activeHealthSources, activeSourceIds, defaultContext, type SourceContext } from './registry';

export interface TurnSources {
  /** The provenance of the installed dataset (which source fed which metric). */
  provenance: ProvenanceRow[];
  /** Every active source, sorted. */
  activeIds: string[];
  /** The active sources that feed the health dataset, sorted. */
  activeHealthIds: string[];
}

type TurnShape = Pick<AnalystResponse, 'handlerId' | 'status' | 'retrieval' | 'toolsUsed'> & { answer?: unknown };

/**
 * Plan editing tools. They are not capabilities (the analyst is read-only for health
 * data, so the registry holds only reads), but they read and write targets, never
 * observations: configuration, like the plan reads the manifest tags.
 */
export const PLAN_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'create_training_plan',
  'update_training_plan',
  'set_current_stage',
  'set_path_hold',
  'clear_path_hold',
  'record_deload',
  'archive_training_plan',
]);

export interface ToolSets {
  /** Read the lab store. */
  lab: ReadonlySet<string>;
  /** Read the medication log, which the HAE server holds. */
  hae: ReadonlySet<string>;
  /** Read records every active health source may have supplied. */
  allHealth: ReadonlySet<string>;
  /** Read or edit targets, never observations. */
  configuration: ReadonlySet<string>;
  /**
   * Read things the turn does not list: metrics the model fetched by itself
   * (`metric-provenance`), or the plan weighed against health workouts, recovery
   * signals and strength sessions (`workout-detail`). Which sources fed them cannot
   * be read off the turn, so they are tagged with every active source, as ever:
   * an under-tag would leak, an over-tag only deletes more.
   */
  opaque: ReadonlySet<string>;
}

/** The tool sets, from the `sources` tag of each manifest entry (design §13). */
export function deriveToolSets(entries: readonly Pick<CapabilityManifestEntry, 'tool' | 'sources'>[]): ToolSets {
  const tools = (...tags: SourceTag[]): ReadonlySet<string> => new Set(entries.filter(e => tags.includes(e.sources)).map(e => e.tool));
  return {
    lab: tools('lab'),
    hae: tools('hae'),
    allHealth: tools('all-health'),
    configuration: new Set([...tools('configuration'), ...PLAN_WRITE_TOOLS]),
    opaque: tools('metric-provenance', 'workout-detail'),
  };
}

const TOOLS = deriveToolSets(CAPABILITY_MANIFEST);

/** How a tool is tagged: its manifest tag, `plan-write` for a plan editing tool, or undefined when nothing classifies it. */
export function toolTag(tool: string): SourceTag | 'plan-write' | undefined {
  if (PLAN_WRITE_TOOLS.has(tool)) return 'plan-write';
  return CAPABILITY_MANIFEST.find(e => e.tool === tool)?.sources;
}

const LAB_HANDLERS = new Set(['lab-results']);
const WORKOUT_HANDLERS = new Set(['workout-frequency']);

/** The source id a provenance name stands for. Only the Oura source's own name counts as Oura. */
function sourceIdOfName(name: string): string {
  return name === OURA_SOURCE_NAME ? 'oura' : 'hae';
}

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** The sources that fed one turn. Sorted and distinct; never empty unless nothing is active. */
export function sourceIdsForTurn(turn: TurnShape, sources: TurnSources): string[] {
  const fallback = sorted(sources.activeIds);
  const tags = new Set<string>();
  const tools = turn.toolsUsed ?? [];
  const note = turn.retrieval?.note ?? '';

  // A generic data tool reads metrics the turn does not list: treat it as opaque.
  for (const tool of tools) {
    if (TOOLS.lab.has(tool) || TOOLS.allHealth.has(tool) || TOOLS.hae.has(tool) || TOOLS.configuration.has(tool)) continue;
    return fallback;
  }

  const metrics = turn.retrieval?.metrics ?? [];
  for (const metric of metrics) {
    const named = sources.provenance
      .filter(row => row.metricId === metric.metricId && row.observations > 0)
      .flatMap(row => row.sources.map(sourceIdOfName));
    if (named.length === 0) return fallback;
    for (const id of named) tags.add(id);
  }

  if (LAB_HANDLERS.has(turn.handlerId) || note.includes('Lab results: ') || tools.some(t => TOOLS.lab.has(t))) {
    tags.add('lab');
  }
  if (note.includes('Medication records: ') || tools.some(t => TOOLS.hae.has(t))) {
    tags.add('hae');
  }
  if (WORKOUT_HANDLERS.has(turn.handlerId) || tools.some(t => TOOLS.allHealth.has(t))) {
    for (const id of sources.activeHealthIds) tags.add(id);
  }

  return tags.size > 0 ? sorted(tags) : fallback;
}

/**
 * The active sets for tagging. A registry that cannot be read tags with every
 * known source: unknown is over-tagged, never under-tagged.
 */
export async function loadTurnSources(
  provenance: ProvenanceRow[],
  ctx: SourceContext = defaultContext()
): Promise<TurnSources> {
  try {
    const [activeIds, activeHealthIds] = await Promise.all([activeSourceIds(ctx), activeHealthSources(ctx)]);
    return { provenance, activeIds, activeHealthIds };
  } catch {
    return {
      provenance,
      activeIds: DATA_SOURCES.map(def => def.id).sort(),
      activeHealthIds: DATA_SOURCES.filter(def => def.kind === 'health')
        .map(def => def.id)
        .sort(),
    };
  }
}

/** Tag one finished answer: load the active sets, then attribute the turn. */
export async function tagResponse(response: TurnShape, provenance: ProvenanceRow[]): Promise<string[]> {
  return sourceIdsForTurn(response, await loadTurnSources(provenance));
}
