// ── Analyst providers (SPEC §8) ─────────────────────────
//
// Three implementations of the same tiny interface:
//
//   DemoAnalystProvider          deterministic handlers over the shared dataset.
//                                No credentials, no network, nothing leaves the machine.
//   OpenAICompatibleProvider     any OpenAI-compatible POST /chat/completions:
//                                OpenAI, OpenRouter, LM Studio, llama.cpp, vLLM,
//                                Ollama, Together and the rest.
//   AnthropicProvider            the Messages API (POST /v1/messages).
//
// A provider's only job is to make one non-streaming request and hand the
// model's *text* back. Parsing, validation, evidence filtering and the grounding
// check all happen in the service (see validate.ts), so a provider can never
// return a shaped claim that skipped validation.
//
// `complete(system, user)` is the shared request path itself: the analyst
// question goes through it, and so does the morning briefing
// (src/lib/briefing/engine.ts), which needs the same HTTP call with its own
// prompt instead of a retrieval bundle. There is exactly one implementation per
// wire protocol, so JSON mode, timeouts, rate-limit retries and error scrubbing
// cannot drift between the two callers.
//
// Credentials are read from the server environment only, are handed straight to
// fetch(), and never appear in a return value, an error message or a log.

import {
  PROVIDER_DISPLAY_NAMES,
  REMOTE_SENDING_CATEGORIES,
  readAnalystConfig,
  type AnalystConfig,
} from './config';
import { HANDLERS } from './handlers';
import { buildAnalystUserMessage } from './systemPrompt';
import { hostOf, safeExcerpt, scrubText } from './scrub';
import { parseAnalystSse } from './stream';
import type {
  AnalystAnswer,
  AnalystProvider,
  AnalystProviderContext,
  AnalystProviderResult,
} from './types';

export const DEMO_LABEL = 'Demo analyst';
export const OPENAI_LABEL = PROVIDER_DISPLAY_NAMES.openai;
export const ANTHROPIC_LABEL = PROVIDER_DISPLAY_NAMES.anthropic;

/** Anthropic requires an explicit API version on every request. */
const ANTHROPIC_VERSION = '2023-06-01';

/** A provider-side failure with a message that is already safe to show. */
export class AnalystProviderError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'AnalystProviderError';
    this.statusCode = statusCode;
  }
}

/** Bounded retries for a gateway that reports a transient rate limit. */
export const RATE_LIMIT_RETRIES = 2;
export const RATE_LIMIT_BACKOFF_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * An error reported inside an HTTP 200 body.
 *
 * OpenRouter (and some other gateways) answer 200 with
 * `{"error":{"code":429,"message":"… is temporarily rate-limited upstream"}}`
 * and no `choices` at all. Reading that as "the model said nothing" hides the
 * real cause — a rate limit is retryable, a silent model is not.
 */
export function inBodyError(payload: unknown): { message: string; code: number | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') {
    // Some gateways use a top-level string error.
    return typeof error === 'string' ? { message: error, code: null } : null;
  }
  const entry = error as Record<string, unknown>;
  const message = typeof entry.message === 'string' ? entry.message : 'The provider reported an error.';
  const raw = entry.code;
  const code = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
  return { message, code };
}

interface FirstChoice {
  /** Non-blank content, or null. A length-truncated reply that has content keeps it. */
  text: string | null;
  finish: string | null;
  choice: Record<string, unknown> | undefined;
  message: Record<string, unknown> | undefined;
}

/** The first choice of a /chat/completions payload. */
function firstChoice(payload: Record<string, unknown> | null): FirstChoice {
  const choices = payload?.choices;
  const choice = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === 'string' ? message.content : null;
  const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  return { text: content && content.trim() ? content : null, finish, choice, message };
}

export function isRateLimit(code: number | null): boolean {
  return code === 429;
}

// ── Demo provider ───────────────────────────────────────

export class DemoAnalystProvider implements AnalystProvider {
  readonly id = 'demo' as const;
  readonly label = DEMO_LABEL;
  readonly configured = false;
  readonly sendingCategories: string[] = [];

  async answer(context: AnalystProviderContext): Promise<AnalystProviderResult | null> {
    const handler = HANDLERS.find(h => h.id === context.bundle.handlerId);
    if (!handler) return null;
    return { kind: 'answer', answer: handler.run(context) };
  }
}

// ── Remote providers ────────────────────────────────────

interface RemoteAnswerInput {
  messages: { role: 'system' | 'user'; content: string }[];
  jsonMode: boolean;
}

/** The model's raw reply text plus the model id the provider reported. */
export interface ModelCompletion {
  text: string;
  /** Model id reported by the response, falling back to the configured model. */
  model: string | null;
}

/** A provider that can run a plain prompt → text completion (see `complete`). */
export interface CompletionProvider {
  complete(system: string, user: string): Promise<ModelCompletion>;
}

// ── Tool calling (multi-turn) ───────────────────────────
//
// `converse` is the tool-calling path the analyst's routine tools use. It keeps
// the same guarantees as `complete` — one request per call, hard timeout,
// rate-limit retries, scrubbed errors — but carries a whole exchange in a
// protocol-neutral shape and returns either text or tool calls. Each protocol
// maps the neutral shape to its own wire format; nothing above this module sees
// `tool_calls` or `tool_use`.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments; `{ __unparseable: raw }` when the model sent invalid JSON. */
  args: Record<string, unknown>;
}

export interface ToolResultMessage {
  callId: string;
  name: string;
  /** JSON text handed back to the model. */
  content: string;
  isError: boolean;
}

export type LoopMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string | null; toolCalls: ToolCall[] }
  | { role: 'tool'; results: ToolResultMessage[] };

export interface ModelTurn {
  text: string | null;
  toolCalls: ToolCall[];
  model: string | null;
}

/** Callbacks for a streamed tool-calling turn (`converseStreamed`). */
export interface TurnStreamHooks {
  /** Reasoning text as it arrives: display only, never part of the turn. */
  onReasoning?: (text: string) => void;
  /** Reply text as it arrives. The turn may still end in tool calls. */
  onAnswer?: (text: string) => void;
  /** The upstream request is open; call `abort` to cancel it. */
  onOpen?: (abort: () => void) => void;
}

/** A provider that can hold a multi-turn, tool-calling exchange. */
export interface ToolCallingProvider {
  converse(system: string, messages: LoopMessage[], tools: ToolSpec[], toolChoice?: 'auto' | 'none'): Promise<ModelTurn>;
  /** The same turn, streamed. Providers without it are driven through `converse`. */
  converseStreamed?(
    system: string,
    messages: LoopMessage[],
    tools: ToolSpec[],
    toolChoice: 'auto' | 'none',
    hooks: TurnStreamHooks
  ): Promise<ModelTurn>;
}

export function supportsTools(provider: AnalystProvider): provider is AnalystProvider & ToolCallingProvider {
  return typeof (provider as Partial<ToolCallingProvider>).converse === 'function';
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
    return { __unparseable: raw.slice(0, 500) };
  }
  return {};
}

/**
 * An open streaming request: the raw SSE response body plus the way to cancel
 * it. The caller parses the body and MUST call `abort()` when it stops early
 * (a disconnected browser), so the upstream request is cancelled rather than
 * left running.
 */
export interface ProviderStreamHandle {
  response: Response;
  abort: () => void;
}

/** A provider that can stream a prompt → SSE completion (see `answerStream`). */
export interface StreamingProvider {
  /** The system/user messages the streamed request would send. */
  messagesFor(context: AnalystProviderContext): { system: string; user: string };
  answerStream(system: string, user: string): Promise<ProviderStreamHandle>;
}

/**
 * True when a provider can stream a completion. The demo provider computes its
 * answer offline and the Anthropic Messages API streams a different wire format,
 * so a caller offering streaming must check this rather than assume: when it is
 * false the caller falls back to the non-streaming path.
 */
export function supportsStreaming(
  provider: AnalystProvider
): provider is AnalystProvider & StreamingProvider {
  const candidate = provider as Partial<StreamingProvider>;
  return typeof candidate.answerStream === 'function' && typeof candidate.messagesFor === 'function';
}

/**
 * True when a provider speaks the shared completion path.
 *
 * The demo provider computes answers from the dataset and has no model to ask,
 * so a caller that needs a real completion (the briefing) must check this rather
 * than assume every configured provider can be prompted.
 */
export function supportsCompletion(
  provider: AnalystProvider
): provider is AnalystProvider & CompletionProvider {
  return typeof (provider as Partial<CompletionProvider>).complete === 'function';
}

abstract class RemoteAnalystProviderBase implements AnalystProvider {
  abstract readonly id: 'openai' | 'anthropic';
  abstract readonly label: string;
  readonly configured = true;
  readonly sendingCategories = REMOTE_SENDING_CATEGORIES;

  constructor(protected readonly config: AnalystConfig) {}

  /**
   * One non-streaming request over this provider's wire protocol.
   *
   * This is the shared path: `answer()` builds an analyst message and calls it,
   * and the briefing engine calls it with its own prompt. Implementations must
   * throw (never return empty text) and must keep the model id out of anything
   * derived from a credential.
   */
  abstract complete(system: string, user: string): Promise<ModelCompletion>;

  /** Host only — never the key, never a full URL that carried credentials. */
  get destination(): string | null {
    return this.config.endpointHost ?? hostOf(this.config.endpoint);
  }

  get model(): string | null {
    return this.config.model;
  }

  abstract answer(context: AnalystProviderContext): Promise<AnalystProviderResult>;

  /** One POST, with a hard timeout. `body` is never logged. */
  protected async post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AnalystProviderError(
        aborted
          ? `The provider at ${this.destination ?? 'the configured endpoint'} did not respond within ${this.config.timeoutMs} ms.`
          : `The provider at ${this.destination ?? 'the configured endpoint'} could not be reached.`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read a failing response body as a short, scrubbed excerpt. */
  protected async failure(status: number, response: Response): Promise<AnalystProviderError> {
    let excerpt = '';
    try {
      excerpt = safeExcerpt(await response.text(), [this.config.apiKey]);
    } catch {
      excerpt = '';
    }
    const detail = excerpt ? ` Provider said: ${excerpt}` : '';
    return new AnalystProviderError(
      `The provider at ${this.destination ?? 'the configured endpoint'} answered HTTP ${status}.${detail}`,
      status
    );
  }

  protected buildMessages(context: AnalystProviderContext): { system: string; user: string } {
    return {
      system: context.prompt,
      user: buildAnalystUserMessage({
        question: context.question,
        bundle: context.bundle,
        system: context.system,
        notes: context.notes,
        history: context.history,
        pageContext: context.pageContext,
      }),
    };
  }

  /**
   * The system/user message pair for a context, exposed for the streaming path.
   *
   * The service streams the ANSWER the model produces, so it must build the same
   * two messages `answer()` would send. Exposing the builder rather than
   * re-implementing it in the service keeps the streamed request byte-identical
   * in shape to the non-streamed one.
   */
  messagesFor(context: AnalystProviderContext): { system: string; user: string } {
    return this.buildMessages(context);
  }
}

/**
 * Any OpenAI-compatible /chat/completions endpoint.
 *
 * `jsonMode` sends `response_format: {type:"json_object"}` and, on HTTP 400 or
 * an empty reply, retries once without it — servers that do not support the
 * field either reject the request or answer with nothing.
 *
 * Two failure shapes this endpoint family produces are handled explicitly,
 * because both otherwise masquerade as "the model said nothing":
 *
 *   * an error reported *inside* an HTTP 200 body (OpenRouter does this for an
 *     upstream rate limit), which has no `choices` at all;
 *   * a reply that was cut off by the token budget, which has a choice whose
 *     content is empty and `finish_reason: "length"`.
 *
 * A transient rate-limit answer is retried a bounded number of times before it
 * is reported.
 */
// ── Request parameters an endpoint refuses ──────────────
//
// OpenAI's newer models reject `max_tokens` (they take `max_completion_tokens`),
// some accept only the default `temperature`, and some refuse function tools on
// /chat/completions unless reasoning is off (`reasoning_effort: "none"`, applied
// to tool requests only); older local servers know only `max_tokens`. The official endpoint gets `max_completion_tokens` up front; any
// endpoint that answers HTTP 400 naming one of these parameters has the request
// adapted and retried, and the adaptation is remembered for that endpoint and
// model for the life of the process.

export type ParamQuirk = 'max_completion_tokens' | 'no_temperature' | 'tools_without_reasoning';

const QUIRKS_KEY = Symbol.for('vital.analyst.paramQuirks');
function quirkStore(): Map<string, Set<ParamQuirk>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Set<ParamQuirk>> | undefined>;
  return (g[QUIRKS_KEY] ??= new Map());
}

/** Test seam: forget what endpoints have refused. */
export function resetParamQuirks(): void {
  quirkStore().clear();
}

function isOfficialOpenAI(endpoint: string | null): boolean {
  try {
    return endpoint !== null && new URL(endpoint).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/** Which adaptation, if any, an HTTP 400 body asks for. */
export function quirkFromRejection(text: string): ParamQuirk | null {
  let error: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    error = parsed.error && typeof parsed.error === 'object' ? (parsed.error as Record<string, unknown>) : null;
  } catch {
    error = null;
  }
  const param = typeof error?.param === 'string' ? error.param : '';
  const message = typeof error?.message === 'string' ? error.message : text;
  if (param === 'max_tokens' || /\bmax_completion_tokens\b/.test(message)) return 'max_completion_tokens';
  if (param === 'reasoning_effort' || /\breasoning_effort\b/.test(message)) return 'tools_without_reasoning';
  if (param === 'temperature' || /\btemperature\b/i.test(message)) return 'no_temperature';
  return null;
}

function applyQuirks(body: Record<string, unknown>, quirks: Set<ParamQuirk>): void {
  if (quirks.has('max_completion_tokens') && 'max_tokens' in body) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  if (quirks.has('no_temperature')) delete body.temperature;
  if (quirks.has('tools_without_reasoning') && Array.isArray(body.tools) && body.tools.length) {
    body.reasoning_effort = 'none';
    delete body.reasoning;
  }
}

export class OpenAICompatibleProvider extends RemoteAnalystProviderBase {
  readonly id = 'openai' as const;
  readonly label = OPENAI_LABEL;

  async answer(context: AnalystProviderContext): Promise<AnalystProviderResult> {
    const { system, user } = this.buildMessages(context);
    const completion = await this.complete(system, user);
    return { kind: 'text', text: completion.text, model: completion.model };
  }

  async complete(system: string, user: string): Promise<ModelCompletion> {
    const body = this.chatBody(system, user, false);
    const useJsonMode = this.config.jsonMode === 'auto';

    const headers = this.headers();
    let payload = await this.request(headers, body, useJsonMode);
    let first = firstChoice(payload);
    if (useJsonMode && body.response_format && !first.text && first.finish !== 'length') {
      // Some servers (LocalAI with a reasoning model) accept response_format but
      // let the grammar end the reply before any content. Retry once without it.
      delete body.response_format;
      payload = await this.request(headers, body, false);
      first = firstChoice(payload);
    }

    // A truncated reply that DOES carry content is delivered rather than
    // discarded: a short answer beats an error, and the parser downstream decides
    // whether the fragment is usable.
    const model = typeof payload?.model === 'string' ? payload.model : this.config.model;
    if (first.text) return { text: first.text, model };
    throw new AnalystProviderError(this.emptyReplyMessage(first.finish, first.choice, first.message));
  }

  async converse(system: string, messages: LoopMessage[], tools: ToolSpec[], toolChoice: 'auto' | 'none' = 'auto'): Promise<ModelTurn> {
    const body = this.converseBody(system, messages, tools, toolChoice, false);
    const payload = await this.request(this.headers(), body, false);
    const first = firstChoice(payload);
    const rawCalls = Array.isArray(first.message?.tool_calls) ? (first.message.tool_calls as Record<string, unknown>[]) : [];
    const toolCalls: ToolCall[] = rawCalls
      .map((c, i) => {
        const fn = (c.function ?? {}) as Record<string, unknown>;
        return typeof fn.name === 'string'
          ? { id: typeof c.id === 'string' && c.id ? c.id : `call_${i}`, name: fn.name, args: parseArgs(fn.arguments) }
          : null;
      })
      .filter((c): c is ToolCall => c !== null);
    if (!first.text && toolCalls.length === 0) {
      throw new AnalystProviderError(this.emptyReplyMessage(first.finish, first.choice, first.message));
    }
    const model = typeof payload?.model === 'string' ? payload.model : this.config.model;
    return { text: first.text, toolCalls, model };
  }

  /**
   * One tool-calling turn over a streamed completion: reasoning and reply text
   * are handed to the hooks as they arrive, tool-call fragments are assembled by
   * index, and the finished turn is returned exactly as `converse` would.
   */
  async converseStreamed(
    system: string,
    messages: LoopMessage[],
    tools: ToolSpec[],
    toolChoice: 'auto' | 'none',
    hooks: TurnStreamHooks
  ): Promise<ModelTurn> {
    const handle = await this.openStream(this.converseBody(system, messages, tools, toolChoice, true));
    hooks.onOpen?.(handle.abort);
    let text = '';
    let reasoned = false;
    let model: string | null = null;
    let finish: string | null = null;
    let reasoningTokens: number | null = null;
    const calls = new Map<number, { id: string | null; name: string; args: string }>();
    try {
      for await (const event of parseAnalystSse(handle.response.body as ReadableStream<Uint8Array>)) {
        if (event.kind === 'reasoning') {
          reasoned = true;
          hooks.onReasoning?.(event.text);
        } else if (event.kind === 'answer') {
          text += event.text;
          hooks.onAnswer?.(event.text);
        } else if (event.kind === 'tool_call') {
          const call = calls.get(event.index) ?? { id: null, name: '', args: '' };
          call.id = call.id ?? event.id;
          if (event.name) call.name = call.name || event.name;
          call.args += event.arguments;
          calls.set(event.index, call);
        } else {
          model = event.model;
          finish = event.finishReason;
          reasoningTokens = event.reasoningTokens;
        }
      }
    } catch (error) {
      handle.abort();
      if (error instanceof AnalystProviderError) throw error;
      throw new AnalystProviderError(`The provider at ${this.destination ?? 'the configured endpoint'} ended the stream early.`);
    }
    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([i, c]) => ({ id: c.id ?? `call_${i}`, name: c.name, args: parseArgs(c.args) }));
    const reply = text.trim() ? text : null;
    if (!reply && toolCalls.length === 0) {
      const usage = reasoningTokens ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : undefined;
      throw new AnalystProviderError(this.emptyReplyMessage(finish, { usage }, reasoned ? { reasoning: 'streamed' } : undefined));
    }
    return { text: reply, toolCalls, model: model ?? this.config.model };
  }

  private headers(stream = false): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (stream) headers.Accept = 'text/event-stream';
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  /** The /chat/completions body for a tool-calling turn. */
  private converseBody(
    system: string,
    messages: LoopMessage[],
    tools: ToolSpec[],
    toolChoice: 'auto' | 'none',
    stream: boolean
  ): Record<string, unknown> {
    const wire: Record<string, unknown>[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: m.text ?? '' };
        if (m.toolCalls.length) {
          msg.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        }
        wire.push(msg);
      } else {
        for (const r of m.results) wire.push({ role: 'tool', tool_call_id: r.callId, content: r.content });
      }
    }
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: wire,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream,
    };
    if (this.config.reasoningEffort) body.reasoning = { effort: this.config.reasoningEffort };
    if (tools.length) {
      // response_format is never combined with tools: several servers reject the pair.
      body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = toolChoice;
    }
    return body;
  }

  /** POST the body, handling the HTTP 400 JSON-mode retry, in-body errors and rate limits. */
  private async request(
    headers: Record<string, string>,
    body: Record<string, unknown>,
    useJsonMode: boolean
  ): Promise<Record<string, unknown> | null> {
    let payload: Record<string, unknown> | null = null;
    const key = `${this.url()} ${this.config.model ?? ''}`;
    const store = quirkStore();
    const quirks = store.get(key) ?? new Set<ParamQuirk>(isOfficialOpenAI(this.url()) ? ['max_completion_tokens'] : []);
    applyQuirks(body, quirks);
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
      let response = await this.post(this.url(), headers, body);
      // A 400 naming a parameter: adapt and retry, each adaptation at most once.
      for (let tries = 0; response.status === 400 && tries < 3; tries++) {
        const text = await response.clone().text().catch(() => '');
        const quirk = quirkFromRejection(text);
        const applies = quirk !== 'tools_without_reasoning' || (Array.isArray(body.tools) && body.tools.length > 0);
        if (quirk && applies && !quirks.has(quirk)) {
          quirks.add(quirk);
          store.set(key, quirks);
          applyQuirks(body, quirks);
        } else if (useJsonMode && 'response_format' in body && attempt === 0) {
          // Retry once without response_format: the endpoint may not support it.
          delete body.response_format;
        } else {
          break;
        }
        response = await this.post(this.url(), headers, body);
      }
      if (!response.ok) throw await this.failure(response.status, response);

      payload = await this.readJson(response);
      const reported = inBodyError(payload);
      if (!reported) break;

      if (isRateLimit(reported.code) && attempt < RATE_LIMIT_RETRIES) {
        await delay(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw new AnalystProviderError(
        `The provider at ${this.destination ?? 'the configured endpoint'} refused the request: ${scrubText(reported.message, [
          this.config.apiKey,
        ])}`,
        reported.code
      );
    }
    return payload;
  }

  /**
   * The message for a reply with no content at all.
   *
   * When the model spent its whole budget on REASONING, "stopped at the token
   * limit" blames the wrong thing and hides the cause, so that case is reported
   * distinctly: the model reasoned its way through the entire completion budget
   * and never began an answer. Reasoning text itself is never promoted into an
   * answer — it is not the JSON object that was asked for, and an answer invented
   * from it would not have been validated.
   */
  private emptyReplyMessage(
    finish: string | null,
    choice: Record<string, unknown> | undefined,
    message: Record<string, unknown> | undefined
  ): string {
    if (finish !== 'length') {
      return 'The provider answered with an empty message, so there was nothing to validate.';
    }
    if (this.spentBudgetOnReasoning(choice, message)) {
      return `The provider spent its whole ${this.config.maxTokens} token budget on the model's reasoning and never began an answer, so there was nothing to validate. Raise ANALYST_MAX_TOKENS, lower ANALYST_REASONING_EFFORT, or ask a narrower question.`;
    }
    return `The provider stopped at the ${this.config.maxTokens} token limit before producing an answer. Raise ANALYST_MAX_TOKENS or ask a narrower question.`;
  }

  /** True when a length-truncated reply produced reasoning but no content. */
  private spentBudgetOnReasoning(
    choice: Record<string, unknown> | undefined,
    message: Record<string, unknown> | undefined
  ): boolean {
    if (typeof message?.reasoning === 'string' && message.reasoning.trim().length > 0) return true;
    const usage = choice?.usage ?? message?.usage;
    const record = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : null;
    const details = record?.completion_tokens_details;
    const detailRecord = details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
    const reasoningTokens = detailRecord?.reasoning_tokens;
    return typeof reasoningTokens === 'number' && reasoningTokens > 0;
  }

  /**
   * Open a streamed completion.
   *
   * The response body is returned unread: the caller parses the SSE frames and
   * calls `abort()` when it stops early. The timeout is deliberately NOT applied
   * to the body read — a reasoning model streams for a while, and a timer that
   * cannot distinguish "still streaming" from "hung" would cut a working answer
   * off. Instead the connection is bounded by the caller's own read loop, and a
   * hard timeout still bounds the time to the FIRST byte (the headers).
   */
  async answerStream(system: string, user: string): Promise<ProviderStreamHandle> {
    return this.openStream(this.chatBody(system, user, true));
  }

  /**
   * POST a `stream: true` body and return the unread event stream. A 400 is
   * handled as on the non-streaming path: a named parameter quirk is learned and
   * applied, or response_format is dropped once, then the request is retried.
   */
  private async openStream(body: Record<string, unknown>): Promise<ProviderStreamHandle> {
    const headers = this.headers(true);
    const key = `${this.url()} ${this.config.model ?? ''}`;
    const store = quirkStore();
    const quirks = store.get(key) ?? new Set<ParamQuirk>(isOfficialOpenAI(this.url()) ? ['max_completion_tokens'] : []);
    applyQuirks(body, quirks);

    const controller = new AbortController();
    const send = async (): Promise<Response> => {
      try {
        return await fetch(this.url(), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new AnalystProviderError(
          aborted
            ? `The provider at ${this.destination ?? 'the configured endpoint'} did not respond within ${this.config.timeoutMs} ms.`
            : `The provider at ${this.destination ?? 'the configured endpoint'} could not be reached.`
        );
      }
    };

    // A gateway that rejects `stream: true` (or `response_format`) answers with
    // an ordinary JSON error, not an event stream.
    let response = await send();
    for (let tries = 0; response.status === 400 && tries < 3; tries++) {
      const text = await response.clone().text().catch(() => '');
      const quirk = quirkFromRejection(text);
      const applies = quirk !== 'tools_without_reasoning' || (Array.isArray(body.tools) && body.tools.length > 0);
      if (quirk && applies && !quirks.has(quirk)) {
        quirks.add(quirk);
        store.set(key, quirks);
        applyQuirks(body, quirks);
      } else if (this.config.jsonMode === 'auto' && 'response_format' in body) {
        delete body.response_format;
      } else {
        break;
      }
      response = await send();
    }

    if (!response.ok) throw await this.failure(response.status, response);
    if (!response.body) {
      throw new AnalystProviderError('The provider answered a streaming request with no response body.');
    }
    return { response, abort: () => controller.abort() };
  }

  /**
   * The shared /chat/completions body. Both the streaming and non-streaming paths
   * go through it so max_tokens, temperature and the reasoning control cannot
   * drift between them.
   */
  private chatBody(system: string, user: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream,
    };
    // Only sent when configured: an endpoint that does not know the field is
    // never handed one. `reasoning.effort` is the shape this gateway accepts.
    if (this.config.reasoningEffort) body.reasoning = { effort: this.config.reasoningEffort };
    if (this.config.jsonMode === 'auto') body.response_format = { type: 'json_object' };
    return body;
  }

  private url(): string {
    // `endpoint` is non-null whenever a remote provider is constructed.
    return this.config.endpoint as string;
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new AnalystProviderError('The provider answered with body that is not JSON.');
    }
  }
}

/** The Anthropic Messages API. No `response_format` exists, so jsonMode is ignored. */
export class AnthropicProvider extends RemoteAnalystProviderBase {
  readonly id = 'anthropic' as const;
  readonly label = ANTHROPIC_LABEL;

  async converse(system: string, messages: LoopMessage[], tools: ToolSpec[], toolChoice: 'auto' | 'none' = 'auto'): Promise<ModelTurn> {
  const wire: Record<string, unknown>[] = messages.map(m => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'assistant') {
      const content: Record<string, unknown>[] = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      return { role: 'assistant', content };
    }
    return {
      role: 'user',
      content: m.results.map(r => ({ type: 'tool_result', tool_use_id: r.callId, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    };
  });
  const body: Record<string, unknown> = {
    model: this.config.model,
    max_tokens: this.config.maxTokens,
    temperature: this.config.temperature,
    system,
    messages: wire,
  };
  if (tools.length) {
    body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    body.tool_choice = { type: toolChoice };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
  if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;

  const response = await this.postJson(this.config.endpoint as string, headers, body);
  const blocks = Array.isArray(response.content) ? (response.content as Record<string, unknown>[]) : [];
  const text = blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n');
  const toolCalls: ToolCall[] = blocks
    .filter(b => b?.type === 'tool_use' && typeof b.name === 'string')
    .map((b, i) => ({ id: typeof b.id === 'string' ? b.id : `toolu_${i}`, name: b.name as string, args: parseArgs(b.input) }));
  if (!text.trim() && toolCalls.length === 0) {
    throw new AnalystProviderError(
      response.stop_reason === 'max_tokens'
        ? `The provider stopped at the ${this.config.maxTokens} token limit before producing an answer. Raise ANALYST_MAX_TOKENS or ask a narrower question.`
        : 'The provider returned no text content, so there was nothing to validate.'
    );
  }
  const model = typeof response.model === 'string' ? response.model : this.config.model;
  return { text: text.trim() ? text : null, toolCalls, model };
}

  /** POST and read JSON, retrying a transient rate limit (HTTP 429) a bounded number of times. */
  private async postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.post(url, headers, body);
      if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        await delay(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        continue;
      }
      if (!response.ok) throw await this.failure(response.status, response);
      try {
        return (await response.json()) as Record<string, unknown>;
      } catch {
        throw new AnalystProviderError('The provider answered with a body that is not JSON.');
      }
    }
  }

  async answer(context: AnalystProviderContext): Promise<AnalystProviderResult> {
    const { system, user } = this.buildMessages(context);
    const completion = await this.complete(system, user);
    return { kind: 'text', text: completion.text, model: completion.model };
  }

  async complete(system: string, user: string): Promise<ModelCompletion> {
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system,
      messages: [{ role: 'user', content: user }],
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;

    const response = await this.post(this.config.endpoint as string, headers, body);
    if (!response.ok) throw await this.failure(response.status, response);

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new AnalystProviderError('The provider answered with a body that is not JSON.');
    }

    const blocks = payload.content;
    const text = Array.isArray(blocks)
      ? blocks
          .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
          .filter(b => b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text as string)
          .join('\n')
      : '';
    if (!text.trim()) {
      throw new AnalystProviderError('The provider returned no text content, so there was nothing to validate.');
    }
    const model = typeof payload.model === 'string' ? payload.model : this.config.model;
    return { text, model };
  }
}

// ── Factory ─────────────────────────────────────────────

/**
 * Build the provider for a resolved configuration.
 *
 * Throws before any network call when the configuration is unusable, so the
 * service can report a misconfiguration rather than a confusing request failure.
 */
export function createProvider(config: AnalystConfig): AnalystProvider {
  if (config.misconfiguredReason) {
    throw new AnalystProviderError(config.misconfiguredReason);
  }
  switch (config.provider) {
    case 'openai':
      return new OpenAICompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'demo':
      return new DemoAnalystProvider();
    default: {
      const exhaustive: never = config.provider;
      throw new AnalystProviderError(`Unsupported analyst provider "${String(exhaustive)}".`);
    }
  }
}

/**
 * Resolve the provider for an environment, falling back to the demo provider
 * when the configuration is unusable. The service does not use this: it calls
 * readAnalystConfig + createProvider so it can *report* a misconfiguration
 * instead of quietly degrading to demo output.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): AnalystProvider {
  try {
    return createProvider(readAnalystConfig(env));
  } catch {
    return new DemoAnalystProvider();
  }
}