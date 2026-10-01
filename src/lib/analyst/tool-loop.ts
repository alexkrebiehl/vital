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
//
// Tool calling rules out JSON mode, so a model may finish in prose. That reply
// gets one repair turn (tools off) asking for the same answer as the JSON object.
// When the repair is not JSON either, the prose draft is returned too, so the
// caller can show it as written rather than fail. (A JSON-mode completion is no
// better a repair: some local servers answer it with nothing, and reasoning
// models can spend the whole token budget before writing.)
//
// With hooks (the streaming route), each turn is streamed when the provider can
// stream one, and the caller hears about every step: reasoning and reply text as
// they arrive, and a step whenever the text so far turned out not to be the
// answer (a tool is about to run, or the reply is being repaired).

import {
  AnalystProviderError,
  type LoopMessage,
  type ModelTurn,
  type ToolCallingProvider,
  type ToolResultMessage,
  type ToolSpec,
  type TurnStreamHooks,
} from './provider';
import { runTool, toolSpecs, type ToolContext } from './tools';
import { extractJsonObject } from './validate';

export const MAX_TOOL_ROUNDS = 6;
export const MAX_TOOL_CALLS = 12;

export const REPAIR_INSTRUCTION =
  'Your last reply was not the JSON object the instructions require, so it cannot be shown. Reply again with the same answer as one JSON object in the required shape ("title", "analysis", "recommendations", "summary", "uncertainty", "evidence", "followUps") and nothing outside it. Do not call tools.';

export interface ToolLoopResult {
  text: string;
  model: string | null;
  toolsUsed: string[];
  toolOutputs: string[];
  /** True when the answer came from the repair turn. */
  repaired: boolean;
  /** The prose reply that prompted a repair, kept in case the repair fails too. */
  draft?: string;
}

export interface ToolLoopHooks extends TurnStreamHooks {
  /**
   * The text streamed so far was not the answer: `tool` is about to run, or
   * (tool null) the reply is being asked for again as the JSON object.
   */
  onStep?: (step: { tool: string | null }) => void;
  /** Checked between turns and tool calls: once aborted, the loop stops. */
  signal?: AbortSignal;
}

function takeTurn(
  provider: ToolCallingProvider,
  system: string,
  messages: LoopMessage[],
  specs: ToolSpec[],
  choice: 'auto' | 'none',
  hooks: ToolLoopHooks | undefined
): Promise<ModelTurn> {
  if (hooks?.signal?.aborted) throw new AnalystProviderError('The question was cancelled.');
  return hooks && provider.converseStreamed
    ? provider.converseStreamed(system, messages, specs, choice, hooks)
    : provider.converse(system, messages, specs, choice);
}

export async function runToolLoop(
  provider: ToolCallingProvider,
  system: string,
  user: string,
  ctx: ToolContext,
  hooks?: ToolLoopHooks
): Promise<ToolLoopResult> {
  const specs = toolSpecs();
  const messages: LoopMessage[] = [{ role: 'user', content: user }];
  const toolsUsed: string[] = [];
  const toolOutputs: string[] = [];
  let calls = 0;
  let model: string | null = null;

  let repairing = false;
  let draft: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    const final = repairing || round >= MAX_TOOL_ROUNDS - 1 || calls >= MAX_TOOL_CALLS;
    const turn = await takeTurn(provider, system, messages, specs, final ? 'none' : 'auto', hooks);
    model = turn.model ?? model;
    if (turn.toolCalls.length === 0 || final) {
      if (!turn.text) throw new AnalystProviderError('The model kept calling tools and never answered.');
      if (extractJsonObject(turn.text)) return { text: turn.text, model, toolsUsed, toolOutputs, repaired: repairing, ...(draft ? { draft } : {}) };
      if (repairing) return { text: turn.text, model, toolsUsed, toolOutputs, repaired: true, draft: draft ?? turn.text };
      // Prose instead of the JSON object: ask once for the same answer in the required shape.
      draft = turn.text;
      messages.push({ role: 'assistant', text: turn.text, toolCalls: [] });
      messages.push({ role: 'user', content: REPAIR_INSTRUCTION });
      repairing = true;
      hooks?.onStep?.({ tool: null });
      continue;
    }
    messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
    const results: ToolResultMessage[] = [];
    for (const call of turn.toolCalls) {
      if (calls >= MAX_TOOL_CALLS) {
        results.push({ callId: call.id, name: call.name, content: JSON.stringify({ error: 'Tool limit reached; answer now.' }), isError: true });
        continue;
      }
      if (hooks?.signal?.aborted) throw new AnalystProviderError('The question was cancelled.');
      calls++;
      toolsUsed.push(call.name);
      hooks?.onStep?.({ tool: call.name });
      const out = await runTool(call.name, call.args, ctx);
      toolOutputs.push(out.content);
      results.push({ callId: call.id, name: call.name, content: out.content, isError: out.isError });
    }
    messages.push({ role: 'tool', results });
  }
  throw new AnalystProviderError('The model did not answer within the tool-call limit.');
}
