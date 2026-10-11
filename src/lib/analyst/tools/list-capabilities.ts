// ── Analyst tool: list_capabilities (SERVER ONLY) ───────────
//
// The discovery tool (design §4.3). Without arguments: one entry per capability with
// its live coverage. With `area`: that area. With `id`: the capability's full parameter
// text and example calls. It returns what the app holds and where to read it, never a
// health value. The registry is read at call time (it imports the tools that import this).

import { invalidArgs } from '../capabilities/envelope';
import { CAPABILITY_MANIFEST } from '../capabilities/manifest';
import { collectCoverageRows, coverageText } from '../capabilities/coverage-index';
import { parametersText, schemaOfCapability } from '../capabilities/params-text';
import { capabilityById, CAPABILITIES, type AnyCapability } from '../capabilities/registry';
import { capabilityContext, isOutcome, outcomeOf } from './capability-tool';
import type { AnalystTool } from './index';

export const LIST_CAPABILITIES_TOOL = 'list_capabilities';
const AREAS = [...new Set(CAPABILITY_MANIFEST.map(e => e.area))];

/** Up to three ids that share a word with what was typed. */
function closest(typed: string, ids: readonly string[]): string[] {
  const words = typed.toLowerCase().split(/[._\s]+/).filter(w => w.length >= 3);
  const score = (id: string) => id.toLowerCase().split(/[._]+/).filter(t => words.some(w => t.startsWith(w.slice(0, 4)) || w.startsWith(t.slice(0, 4)))).length;
  return ids
    .map(id => ({ id, s: score(id) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(x => x.id);
}

const callText = (tool: string, args: Record<string, unknown>): string => `${tool} ${JSON.stringify(args)}`;

export const listCapabilities: AnalystTool = {
  name: LIST_CAPABILITIES_TOOL,
  kind: 'read',
  description:
    'What the app holds, with live coverage. No arguments: every capability. area: one area. id: its parameters and example calls.',
  parameters: {
    type: 'object',
    properties: {
      area: { type: 'string', description: 'A capability area, e.g. "sleep".' },
      id: { type: 'string', description: 'A capability id, e.g. "workouts.sessions".' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const cctx = capabilityContext(ctx);
    if (isOutcome(cctx)) return cctx;
    const self = { id: LIST_CAPABILITIES_TOOL };
    const { area, id } = args as { area?: string; id?: string };

    let caps: readonly AnyCapability[] = CAPABILITIES;
    if (area !== undefined) {
      if (!AREAS.includes(area as never)) return outcomeOf(invalidArgs(self, [`area must be one of: ${AREAS.join(', ')}.`]));
      caps = caps.filter(c => c.area === area);
    }
    if (id !== undefined) {
      const cap = capabilityById(id);
      if (!cap) {
        const near = closest(id, CAPABILITIES.map(c => c.id));
        return outcomeOf(invalidArgs(self, [`There is no capability "${id}".`], { didYouMean: near.length ? near : CAPABILITIES.map(c => c.id) }));
      }
      caps = [cap];
    }

    const rows = await collectCoverageRows(caps, cctx);
    if (id !== undefined) {
      const cap = caps[0]!;
      return {
        content: {
          status: 'ok',
          capability: {
            id: cap.id,
            title: cap.title,
            tool: cap.tool,
            area: cap.area,
            description: cap.description,
            parameters: parametersText(schemaOfCapability(cap)),
            coverage: coverageText(rows[0]!.coverage),
            examples: (cap.examples ?? []).map(a => callText(cap.tool, a)),
          },
        },
      };
    }
    return {
      content: {
        status: 'ok',
        capabilities: caps.map((c, i) => ({ id: c.id, title: c.title, tool: c.tool, holds: c.holds ?? c.title, coverage: coverageText(rows[i]!.coverage) })),
        next: 'Call again with an id for a capability\'s parameters and example calls.',
      },
    };
  },
};
