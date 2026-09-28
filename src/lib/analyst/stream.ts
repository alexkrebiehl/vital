// ── Analyst SSE stream parsing (SPEC §8) ────────────────
//
// A reasoning model streams two different things over the same
// `text/event-stream` connection: its REASONING (the model thinking out loud)
// and its ANSWER (the JSON object the analyst validates). The two arrive in
// different fields of the same delta, so they are kept apart here and never
// mixed:
//
//   delta.reasoning  → reasoning text   (this gateway's field name)
//   delta.content    → answer text
//   delta.tool_calls → tool-call fragments, keyed by index (the plan tools'
//                      streamed turns; see OpenAICompatibleProvider.converseStreamed)
//
// `delta.reasoning` is the field this gateway actually uses. `reasoning_content`
// is a DIFFERENT field some OpenAI-compatible servers use; accepting it here
// would be guessing at a wire format that was measured, so it is deliberately
// not read. A `data: [DONE]` sentinel ends the stream.
//
// Nothing here touches the network: the reader is handed a ReadableStream and
// this module turns it into typed events, so it is exercised directly in tests
// against a fake stream.

/** One thing a streamed completion produced. */
export type AnalystStreamEvent =
  /** A reasoning delta: the model's own working, not the answer. */
  | { kind: 'reasoning'; text: string }
  /** An answer delta: fragments of the JSON answer object. */
  | { kind: 'answer'; text: string }
  /**
   * A tool-call delta. Calls stream in fragments keyed by `index`: the first
   * fragment usually carries the id and name, later ones append to `arguments`.
   */
  | ToolCallDelta
  /** The terminal event: the model id, how it finished and the token usage. */
  | {
      kind: 'done';
      model: string | null;
      finishReason: string | null;
      reasoningTokens: number | null;
    };

/** One fragment of a streamed tool call (`delta.tool_calls[i]`). */
export interface ToolCallDelta {
  kind: 'tool_call';
  index: number;
  id: string | null;
  name: string | null;
  arguments: string;
}

/** The usage counters a final streamed chunk may carry. */
export interface StreamUsage {
  reasoningTokens: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Split an SSE buffer into whole frames, keeping the trailing partial frame.
 *
 * A frame is terminated by a blank line. Anything after the last blank line is
 * incomplete and is returned as `remainder` to be prepended to the next chunk —
 * a delta split across two TCP reads must not be lost or double-counted.
 */
export function splitSseFrames(buffer: string): { frames: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const remainder = parts.pop() ?? '';
  return { frames: parts.filter(frame => frame.trim().length > 0), remainder };
}

/** One frame's contribution, already separated into reasoning and answer. */
export interface FrameContent {
  reasoning: string;
  answer: string;
  model: string | null;
  finishReason: string | null;
  reasoningTokens: number | null;
  toolCalls: ToolCallDelta[];
  /** True when the frame carried the `[DONE]` sentinel. */
  done: boolean;
}

/**
 * Read one SSE frame.
 *
 * A frame carries zero or more `data:` lines; the payload is the JSON object
 * they join to. `event:` and other fields are ignored: the event TYPE is carried
 * inside the delta fields, which is where this gateway puts it.
 */
export function readSseFrame(frame: string): FrameContent {
  const out: FrameContent = {
    reasoning: '',
    answer: '',
    model: null,
    finishReason: null,
    reasoningTokens: null,
    toolCalls: [],
    done: false,
  };

  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimStart();
    if (!line.startsWith('data:')) continue;
    dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (dataLines.length === 0) return out;

  const payload = dataLines.join('\n').trim();
  // The protocol's end-of-stream sentinel is not JSON.
  if (payload === '[DONE]') {
    out.done = true;
    return out;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A frame that is not JSON is not a delta; it is skipped rather than
    // guessed at, so a comment/keepalive line cannot become an answer.
    return out;
  }

  const record = asRecord(parsed);
  if (!record) return out;

  if (typeof record.model === 'string') out.model = record.model;

  const usage = asRecord(record.usage);
  const details = usage ? asRecord(usage.completion_tokens_details) : null;
  if (details) out.reasoningTokens = numberOrNull(details.reasoning_tokens);

  const choices = record.choices;
  const first = Array.isArray(choices) ? asRecord(choices[0]) : null;
  if (!first) return out;

  if (typeof first.finish_reason === 'string') out.finishReason = first.finish_reason;

  const delta = asRecord(first.delta);
  if (delta) {
    // The reasoning field is `delta.reasoning` on this gateway.
    if (typeof delta.reasoning === 'string') out.reasoning = delta.reasoning;
    if (typeof delta.content === 'string') out.answer = delta.content;
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((raw, i) => {
        const call = asRecord(raw);
        if (!call) return;
        const fn = asRecord(call.function);
        out.toolCalls.push({
          kind: 'tool_call',
          // A server that sends each call whole may leave the index out.
          index: typeof call.index === 'number' ? call.index : i,
          id: typeof call.id === 'string' && call.id ? call.id : null,
          name: typeof fn?.name === 'string' && fn.name ? fn.name : null,
          arguments: typeof fn?.arguments === 'string' ? fn.arguments : '',
        });
      });
    }
  }

  return out;
}

/**
 * Turn a streamed response body into typed events.
 *
 * The done event is emitted exactly once, when `[DONE]` arrives or the body
 * ends. A stream that ends without `[DONE]` still yields `done` — the caller
 * sees the same terminal event either way rather than hanging on a missing
 * sentinel.
 */
export async function* parseAnalystSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<AnalystStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let model: string | null = null;
  let finishReason: string | null = null;
  let reasoningTokens: number | null = null;
  let sawDone = false;

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = splitSseFrames(buffer);
      buffer = remainder;
      for (const frame of frames) {
        const content = readSseFrame(frame);
        if (content.model) model = content.model;
        if (content.finishReason) finishReason = content.finishReason;
        if (content.reasoningTokens !== null) reasoningTokens = content.reasoningTokens;
        if (content.reasoning) yield { kind: 'reasoning', text: content.reasoning };
        if (content.answer) yield { kind: 'answer', text: content.answer };
        yield* content.toolCalls;
        if (content.done) {
          sawDone = true;
          break;
        }
      }
    }
    // A final partial frame with no terminating blank line.
    if (!sawDone && buffer.trim().length > 0) {
      const content = readSseFrame(buffer);
      if (content.model) model = content.model;
      if (content.finishReason) finishReason = content.finishReason;
      if (content.reasoningTokens !== null) reasoningTokens = content.reasoningTokens;
      if (content.reasoning) yield { kind: 'reasoning', text: content.reasoning };
      if (content.answer) yield { kind: 'answer', text: content.answer };
      yield* content.toolCalls;
    }
  } finally {
    reader.releaseLock();
  }

  yield { kind: 'done', model, finishReason, reasoningTokens };
}
