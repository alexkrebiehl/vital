// ── Reading through an existing tool (SERVER ONLY) ──────
//
// Until the tools are rebuilt on capabilities, a capability reads by running the
// tool that serves it, unchanged: same arguments, same checks, same content. This
// wrapper adds only what every capability owes: the privacy check first, the
// argument problems and failures as envelope statuses, and the tool's content as
// `data`. Nothing is copied from the tools and nothing is written.

import { checkArgs } from '../../tools/args';
import type { AnalystTool, ToolContext } from '../../tools';
import { ANALYST_TOOLS } from '../../tools';
import { DATA_TOOLS } from '../../tools/data';
import { invalidArgs, ok, privacyBlocked, sourceUnavailable, type Envelope } from '../envelope';
import type { CapabilityContext, CapabilityManifestEntry } from '../types';

/** Decides whether a tool error means the source could not be read, rather than the call being wrong. */
export type SourceDown = (ctx: CapabilityContext, content: Record<string, unknown>) => Promise<boolean>;

export function toolNamed(name: string): AnalystTool {
  const tool = [...DATA_TOOLS, ...ANALYST_TOOLS].find(t => t.name === name);
  if (!tool) throw new Error(`No analyst tool "${name}".`);
  return tool;
}

export function readThrough(entry: Pick<CapabilityManifestEntry, 'id' | 'title' | 'tool' | 'category'>, sourceDown?: SourceDown) {
  return async (args: Record<string, unknown>, ctx: CapabilityContext): Promise<Envelope<unknown>> => {
    if (!ctx.policy.allows(entry.category)) return privacyBlocked(entry);
    const tool = toolNamed(entry.tool);
    const problems = checkArgs(tool.parameters, args);
    if (problems.length) return invalidArgs(entry, problems);
    const toolCtx: ToolContext = { data: ctx.access, system: ctx.system, deps: ctx.routine, changes: [] };
    try {
      const outcome = await tool.run(args, toolCtx);
      if (!outcome.isError) return ok(entry, outcome.content);
      const content = (outcome.content ?? {}) as Record<string, unknown>;
      const message = typeof content.error === 'string' ? content.error : typeof content.reason === 'string' ? content.reason : 'The read failed.';
      if (sourceDown && (await sourceDown(ctx, content))) return sourceUnavailable(entry, message);
      const { error: _error, ...hints } = content;
      return invalidArgs(entry, [message], hints);
    } catch (error) {
      return sourceUnavailable(entry, error instanceof Error ? error.message : 'The read failed.');
    }
  };
}
