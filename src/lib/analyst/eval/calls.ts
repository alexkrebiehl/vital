// ── The tool calls of one question, read from the last request sent to the model ──
//
// The live script has no hook into the tool loop, and needs none: the last request of a
// question carries the whole exchange, with every call the model made and its arguments,
// in the wire format of the provider. Pure; nothing here prints or stores a body.

import type { EvalCall } from './types';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : null);

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return obj(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return obj(raw) ?? {};
}

/** OpenAI-compatible (`tool_calls`) and Anthropic (`tool_use` blocks) requests; anything else holds no calls. */
export function callsFromRequest(body: unknown): EvalCall[] {
  const messages = obj(body)?.messages;
  if (!Array.isArray(messages)) return [];
  const calls: EvalCall[] = [];
  for (const m of messages) {
    const msg = obj(m);
    if (!msg || msg.role !== 'assistant') continue;
    if (Array.isArray(msg.tool_calls)) {
      for (const c of msg.tool_calls) {
        const fn = obj(obj(c)?.function);
        if (fn && typeof fn.name === 'string') calls.push({ tool: fn.name, args: parseArgs(fn.arguments) });
      }
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = obj(block);
        if (b && b.type === 'tool_use' && typeof b.name === 'string') calls.push({ tool: b.name, args: parseArgs(b.input) });
      }
    }
  }
  return calls;
}
