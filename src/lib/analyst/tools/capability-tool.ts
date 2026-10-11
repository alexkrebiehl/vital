// ── Tools that run a capability (SERVER ONLY) ───────────
//
// A tool built on a capability does no work of its own: it builds the capability's
// context from the question's, runs `read`, and hands the model the envelope. An
// envelope is an error only for the statuses design §6.2 says are.

import { REFERENCE_TZ } from '../../adapters/dataset';
import { isErrorStatus, privacyBlocked, type Envelope } from '../capabilities/envelope';
import { CAPABILITY_MANIFEST } from '../capabilities/manifest';
import { ALLOW_ALL, type CapabilityContext } from '../capabilities/types';
import type { ToolContext, ToolOutcome } from './index';

/** The capability context of a tool call, or the error to return when the call has no data readers. */
export function capabilityContext(ctx: ToolContext): CapabilityContext | ToolOutcome {
  if (!ctx.data) {
    return { isError: true, content: { error: 'Health data is not available through tools for this question; use the context provided.' } };
  }
  return { system: ctx.system, refKey: ctx.data.refKey, tz: REFERENCE_TZ, env: process.env, access: ctx.data, routine: ctx.deps, policy: ctx.data.policy ?? ALLOW_ALL, ...(ctx.data.app ? { app: ctx.data.app } : {}) };
}

export const isOutcome = (x: CapabilityContext | ToolOutcome): x is ToolOutcome => 'content' in x;

export const outcomeOf = (env: Envelope<unknown>): ToolOutcome => ({ content: env, isError: isErrorStatus(env.status) });

/** Run a read against a tool call's context. */
export async function runCapability(ctx: ToolContext, read: (cctx: CapabilityContext) => Promise<Envelope<unknown>>): Promise<ToolOutcome> {
  const cctx = capabilityContext(ctx);
  if (isOutcome(cctx)) return cctx;
  return outcomeOf(await read(cctx));
}

/**
 * The privacy hook for every tool (design §9.2): a tool whose capabilities the AI privacy
 * setting all withholds is refused before it runs, whoever wrote it. A tool that serves
 * several categories (get_app_data) checks each capability in its own read.
 */
export function policyGate(tool: string, ctx: ToolContext): ToolOutcome | null {
  const policy = ctx.data?.policy ?? ALLOW_ALL;
  const entries = CAPABILITY_MANIFEST.filter(e => e.tool === tool);
  if (entries.length === 0 || entries.some(e => policy.allows(e.category))) return null;
  return outcomeOf(privacyBlocked(entries[0]!));
}
