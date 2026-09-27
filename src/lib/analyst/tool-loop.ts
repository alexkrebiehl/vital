// ── Tool-calling loop (SERVER ONLY) ─────────────────────
//
// One question, several model turns: the model may call the routine tools, see
// their results, and call more, until it answers with the analyst's JSON object.
// Bounded on every axis so a confused model cannot loop:
//
//   MAX_TOOL_ROUNDS   model turns that may request tools; the last turn is sent
//                     with tool_choice "none", which forces an answer
//   MAX_TOOL_CALLS    tool executions across the whole question
//   writes            at most MAX_WRITES_PER_QUESTION plan changes (tools/index.ts)
//
// Tool results are returned so the grounding check can accept numbers the model
// quotes from them.

import { AnalystProviderError, type LoopMessage, type ToolCallingProvider, type ToolResultMessage } from './provider';
import { runTool, toolSpecs, type ToolContext } from './tools';

export const MAX_TOOL_ROUNDS = 6;
export const MAX_TOOL_CALLS = 12;

export interface ToolLoopResult {
  text: string;
  model: string | null;
  toolsUsed: string[];
  toolOutputs: string[];
}

export async function runToolLoop(
  provider: ToolCallingProvider,
  system: string,
  user: string,
  ctx: ToolContext
): Promise<ToolLoopResult> {
  const specs = toolSpecs();
  const messages: LoopMessage[] = [{ role: 'user', content: user }];
  const toolsUsed: string[] = [];
  const toolOutputs: string[] = [];
  let calls = 0;
  let model: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const final = round === MAX_TOOL_ROUNDS - 1 || calls >= MAX_TOOL_CALLS;
    const turn = await provider.converse(system, messages, specs, final ? 'none' : 'auto');
    model = turn.model ?? model;
    if (turn.toolCalls.length === 0 || final) {
      if (turn.text) return { text: turn.text, model, toolsUsed, toolOutputs };
      throw new AnalystProviderError('The model kept calling tools and never answered.');
    }
    messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
    const results: ToolResultMessage[] = [];
    for (const call of turn.toolCalls) {
      if (calls >= MAX_TOOL_CALLS) {
        results.push({ callId: call.id, name: call.name, content: JSON.stringify({ error: 'Tool limit reached; answer now.' }), isError: true });
        continue;
      }
      calls++;
      toolsUsed.push(call.name);
      const out = await runTool(call.name, call.args, ctx);
      toolOutputs.push(out.content);
      results.push({ callId: call.id, name: call.name, content: out.content, isError: out.isError });
    }
    messages.push({ role: 'tool', results });
  }
  throw new AnalystProviderError('The model did not answer within the tool-call limit.');
}
