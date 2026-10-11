// ── Today's briefing: model engine (server-only) ─────────
//
// Which model, if any, writes the briefing (and the training notes, which share
// this engine). The choice is the user's, made in Settings → Preferences → AI
// models, and it is resolved *per generation*, not per view:
//
//   1. the Summary's provider and model. It is first checked with a short,
//      bounded model-list request, memoized per day, when it is on this machine
//      (LM Studio, llama.cpp, vLLM, Ollama) or a fallback is chosen, so a server
//      that is not running does not hold a generation open until the request
//      timeout and the fallback can write instead.
//   2. the Summary fallback, when the Summary has no usable model or its server
//      did not answer. It is also asked once when the Summary's reply
//      fails the number guard (see `generateBriefingText`).
//   3. nothing usable — the caller renders the computed briefing and says so.
//
// The HTTP call itself is the analyst's shared `complete(system, user)` path
// (src/lib/analyst/provider.ts): JSON mode, the hard timeout, the rate-limit
// retry and the error scrubbing are literally the same code the analyst uses, so
// the two cannot drift.
//
// Nothing here logs or returns a credential. A failure is a thrown error with a
// message that is already safe to show.

import {
  DEFAULT_QUESTION_TIMEOUT_MS,
  buildModelConfig,
  envNumber,
  type AnalystConfig,
} from '../analyst/config';
import { createProvider, supportsCompletion } from '../analyst/provider';
import { listModels } from '../ai/models';
import { readAiSettings, type AiSettingsDeps } from '../ai/settings';
import {
  AI_USE_LABELS,
  DEFAULT_BRIEFING_MAX_TOKENS,
  DEFAULT_BRIEFING_TEMPERATURE,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_MAX_ANSWER_CHARS,
  DEFAULT_MAX_REASONING_CHARS,
  selectionFor,
  type AiSelection,
  type AiSettings,
  type SummaryOptions,
} from '../ai/types';
import type { BriefingContext } from './context';
import { BRIEFING_SYSTEM_PROMPT, buildBriefingUserMessage } from './prompt';
import type { BriefingEngineKind, BriefingTraceability } from './types';
import { parseBriefingReply } from './validate';

export type { BriefingEngineKind };
export { DEFAULT_BRIEFING_MAX_TOKENS, DEFAULT_BRIEFING_TEMPERATURE };

/** Bounded probe of a model server on this machine. The owner asked for roughly two seconds. */
export const LOCAL_PROBE_TIMEOUT_MS = 2000;
export const DEFAULT_BRIEFING_TIMEOUT_MS = 60_000;
/**
 * How the briefing recovers from a reply the number guard rejects.
 *
 * The primary engine gets exactly one attempt. If its reply is received but
 * fails the guard, the Summary fallback gets exactly one attempt, and if that
 * also fails — or no fallback is chosen — the computed briefing is served
 * instead. There is never a second roll at the same provider: an attributed
 * figure the guard refused must not be re-rolled until it passes, and a
 * transport/timeout failure still throws as before.
 */
export const BRIEFING_FALLBACK_ATTEMPTS = 1;

export interface BriefingEngine {
  kind: BriefingEngineKind;
  /** Human label shown next to the attribution. Never a key, never a full URL. */
  label: string;
  model: string | null;
  /** Host only. */
  destination: string | null;
  /** Why this engine was chosen, or why there is none. Safe to display. */
  detail: string;
  config: AnalystConfig | null;
  /**
   * The engine a guard-rejected reply is re-asked from, resolved with this one.
   * Absent on an engine built elsewhere: `generateBriefingText` then resolves it.
   */
  fallback?: BriefingEngine;
}

/** Raised when a briefing could not be written. The message is safe to show. */
export class BriefingEngineError extends Error {
  constructor(message: string, readonly traceability: BriefingTraceability | null = null) {
    super(message);
    this.name = 'BriefingEngineError';
  }
}

export interface EngineDeps extends AiSettingsDeps {
  fetchImpl?: typeof fetch;
  /** The settings to use instead of reading them (tests). */
  aiSettings?: AiSettings;
  /**
   * The local calendar day the engine is being resolved for. Supplied by the
   * briefing layer so the probe below can be memoized per day (see
   * `memoizedProbe`). Omitted, every resolution probes afresh.
   */
  day?: string;
  /**
   * Probe again even when a result is already memoized for the day. Set ONLY by
   * the explicit regenerate path: a memoized "unavailable" must not mask a
   * recovery for a user-triggered write.
   */
  forceProbe?: boolean;
}

// ── Local probe ─────────────────────────────────────────

interface LocalProbe {
  ok: boolean;
  detail: string;
}

/**
 * Ask a model server on this machine for its model list, with a hard, short
 * timeout. A probe that hangs would delay the fallback, so it is bounded at
 * LOCAL_PROBE_TIMEOUT_MS and any failure (refused, timed out, not JSON) is
 * reported as unreachable rather than thrown. A server that has no model list
 * (404) answered, so it counts as running.
 */
export async function probeLocalModelServer(selection: AiSelection, deps: EngineDeps = {}): Promise<LocalProbe> {
  const { provider } = selection;
  const result = await listModels(
    { kind: provider.kind, baseUrl: provider.baseUrl, apiKey: provider.apiKey },
    { timeoutMs: LOCAL_PROBE_TIMEOUT_MS, fetchImpl: deps.fetchImpl }
  );
  switch (result.outcome) {
    case 'ok':
      return { ok: true, detail: `The model server at ${result.host} advertised ${result.models.length} model(s).` };
    case 'not_listed':
      return { ok: true, detail: `The model server at ${result.host} answered.` };
    case 'timeout':
      return { ok: false, detail: `The model server did not answer within ${LOCAL_PROBE_TIMEOUT_MS} ms.` };
    case 'invalid_url':
      return { ok: false, detail: result.reason };
    case 'unauthorised':
    case 'http_error':
      return { ok: false, detail: `The model server at ${result.host} answered HTTP ${result.httpStatus}.` };
    default:
      return { ok: false, detail: 'The model server could not be reached.' };
  }
}

// ── The probe memo (per day, per process) ───────────────
//
// A model list can be large (one server answered ~700 KB), and the engine is
// resolved once before each generation. Resolving it once per DAY is enough: the
// answer (running or not) is not re-asked within a day.
//
// The memo lives on `globalThis`, NOT in a module-level variable: Next.js builds
// the page and the route handlers as separate server bundles, so a module-level
// Map would be one copy per bundle and each bundle would still probe (the same
// trap documented at the top of ./index). It is keyed by the provider address,
// so choosing another server probes that one.
//
// An "unavailable" probe is memoized like any other: a generation is attempted
// at most once a day, so a single probe decides the whole day. The ONE caller
// that may probe again is the explicit regenerate path (`forceProbe`), because
// that is a deliberate user action, not an automatic attempt.
interface ProbeMemo {
  day: string;
  probe: LocalProbe;
}

const ENGINE_MEMO_KEY = Symbol.for('vital.briefing.engine-memo');

function engineMemoStore(): { probes: Map<string, ProbeMemo> } {
  const g = globalThis as unknown as Record<symbol, { probes: Map<string, ProbeMemo> } | undefined>;
  if (!g[ENGINE_MEMO_KEY]) g[ENGINE_MEMO_KEY] = { probes: new Map() };
  return g[ENGINE_MEMO_KEY] as { probes: Map<string, ProbeMemo> };
}

/** Resolve the local server once per day; `forceProbe` (regenerate) probes afresh. */
async function memoizedProbe(selection: AiSelection, deps: EngineDeps): Promise<LocalProbe> {
  // No day to key on: probe.
  if (!deps.day) return probeLocalModelServer(selection, deps);

  const store = engineMemoStore();
  const key = `${selection.provider.kind} ${selection.provider.baseUrl.trim().replace(/\/+$/, '')}`;
  const memo = store.probes.get(key);
  if (!deps.forceProbe && memo && memo.day === deps.day) return memo.probe;

  const probe = await probeLocalModelServer(selection, deps);
  store.probes.set(key, { day: deps.day, probe });
  return probe;
}

/** Test seam: forget the memoized probes so a suite starts clean. */
export function resetBriefingEngineMemo(): void {
  engineMemoStore().probes.clear();
}

// ── Configuration ───────────────────────────────────────

/**
 * The configuration a summary selection runs with: the briefing's own budget
 * and temperature unless Settings chose others, no tools, and the briefing
 * timeout from the environment. The briefing passes its own system prompt to
 * `complete()`, so the configuration carries it only because the provider is
 * constructed from an AnalystConfig.
 */
export function buildSummaryConfig(
  selection: AiSelection | null,
  use: 'summary' | 'summary_fallback',
  env: NodeJS.ProcessEnv = process.env
): AnalystConfig {
  const options = (selection?.options ?? {}) as SummaryOptions;
  return buildModelConfig(
    selection,
    {
      maxTokens: options.maxTokens ?? DEFAULT_BRIEFING_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_BRIEFING_TEMPERATURE,
      timeoutMs: envNumber(env, 'BRIEFING_TIMEOUT_MS', DEFAULT_BRIEFING_TIMEOUT_MS, 100, 600_000),
      jsonMode: 'auto',
      tools: 'off',
      context: 'full',
      contextMaxChars: DEFAULT_CONTEXT_MAX_CHARS,
      maxReasoningChars: DEFAULT_MAX_REASONING_CHARS,
      maxAnswerChars: DEFAULT_MAX_ANSWER_CHARS,
      questionTimeoutMs: DEFAULT_QUESTION_TIMEOUT_MS,
      // The briefing's long-standing policy is to send no reasoning field; Settings may choose one.
      reasoningEffort: options.reasoningEffort ?? null,
    },
    { prompt: BRIEFING_SYSTEM_PROMPT, source: 'built-in', file: null, warning: null },
    use,
    { labAssist: false }
  );
}

async function settingsFor(deps: EngineDeps): Promise<AiSettings> {
  return deps.aiSettings ?? (await readAiSettings(deps));
}

function noEngine(detail: string, label = 'analyst model offline'): BriefingEngine {
  return { kind: 'none', label, model: null, destination: null, detail, config: null };
}

/** The fallback engine from settings already read. `kind: 'none'` means there is none to ask. */
function fallbackFrom(settings: AiSettings, env: NodeJS.ProcessEnv): BriefingEngine {
  const selection = selectionFor(settings, 'summary_fallback');
  if (!selection) {
    return noEngine(`No ${AI_USE_LABELS.summary_fallback.toLowerCase()} is chosen in Settings.`, 'no fallback provider');
  }
  const config = buildSummaryConfig(selection, 'summary_fallback', env);
  if (config.misconfiguredReason) return { ...noEngine(config.misconfiguredReason, 'no fallback provider'), model: config.model };
  return {
    kind: 'fallback',
    label: config.providerDisplayName,
    model: config.model,
    destination: config.endpointHost,
    detail: `The summary fallback (${config.providerDisplayName}) is available for a rejected reply.`,
    config,
  };
}

/**
 * Resolve the Summary fallback — the model a guard-rejected reply is re-asked
 * from. No probe is made (a probe would delay the recovery); an unconfigured or
 * unusable fallback is reported as such and the caller serves the computed
 * briefing. `kind: 'none'` means "no fallback available".
 */
export async function resolveBriefingFallback(deps: EngineDeps = {}): Promise<BriefingEngine> {
  const settings = await settingsFor(deps);
  if (settings.unavailable) return noEngine(settings.unavailable, 'no fallback provider');
  return fallbackFrom(settings, deps.env ?? process.env);
}

/**
 * Resolve the engine that should write the briefing.
 *
 * The Summary's model wins when it is usable (and, on this machine, answering).
 * Otherwise the Summary fallback writes it, and then nothing: a configured-but-
 * down local server must fall through, not fail the briefing.
 */
export async function resolveBriefingEngine(deps: EngineDeps = {}): Promise<BriefingEngine> {
  const env = deps.env ?? process.env;
  const settings = await settingsFor(deps);
  if (settings.unavailable) return noEngine(settings.unavailable);

  const fallback = fallbackFrom(settings, env);
  const selection = selectionFor(settings, 'summary');

  let why: string;
  if (!selection) {
    why = 'No summary model is chosen in Settings.';
  } else {
    const config = buildSummaryConfig(selection, 'summary', env);
    if (config.misconfiguredReason) {
      why = config.misconfiguredReason;
    } else {
      let detail = `Using ${config.providerDisplayName} with the chosen model "${config.model}".`;
      let reachable = true;
      // A server on this machine is checked so a stopped one fails fast; any other
      // is checked only when a fallback could write instead (a LAN model server).
      if (config.endpointLoopback || fallback.kind === 'fallback') {
        const probe = await memoizedProbe(selection, deps);
        detail = `${probe.detail} ${detail}`;
        reachable = probe.ok;
        if (!reachable) detail = probe.detail;
      }
      if (reachable) {
        return {
          kind: 'primary',
          label: config.providerDisplayName,
          model: config.model,
          destination: config.endpointHost,
          detail,
          config,
          fallback,
        };
      }
      why = detail;
    }
  }

  if (fallback.kind === 'fallback') {
    return { ...fallback, detail: `${why} The summary fallback (${fallback.label}) writes it instead.` };
  }
  return noEngine(`${why} ${fallback.detail}`.trim());
}

// ── Generation ──────────────────────────────────────────

export interface BriefingModelText {
  headline: string;
  body: string;
  recommendations: string[];
  /** Model id the provider reported, or the configured one. */
  model: string | null;
  latencyMs: number;
  traceability: BriefingTraceability;
  adjustments: string[];
  /** Set only when the fallback provider wrote the text, so the payload says who did. */
  engineKind?: BriefingEngineKind;
  engineDetail?: string;
  provider?: string | null;
  destination?: string | null;
}

interface Completion {
  text: string;
  model: string | null;
  latencyMs: number;
}

/** Build a provider from an engine and take exactly one completion from it. */
async function completeWith(engine: BriefingEngine, system: string, user: string): Promise<Completion> {
  if (!engine.config) throw new BriefingEngineError(engine.detail);

  let provider;
  try {
    provider = createProvider(engine.config);
  } catch (error) {
    throw new BriefingEngineError(
      error instanceof Error ? error.message : 'The briefing provider could not be created.'
    );
  }
  if (!supportsCompletion(provider)) {
    throw new BriefingEngineError('The configured provider cannot be prompted for a briefing.');
  }

  const started = Date.now();
  const completion = await provider.complete(system, user);
  return { text: completion.text, model: completion.model ?? engine.model, latencyMs: Date.now() - started };
}

/**
 * Ask the resolved engine to write the briefing, then validate its text.
 *
 * One primary attempt. If the reply is received but the number guard rejects it
 * — an unreadable reply, forbidden vocabulary, a fabricated figure, or (the
 * case this exists for) a figure the context records under a different metric —
 * the configured fallback provider is asked once. If that reply also fails, or
 * no fallback is configured, this throws `BriefingEngineError` so the caller
 * renders the computed briefing and states why. A transport or timeout failure
 * on the primary is not retried: it throws, as before.
 */
export async function generateBriefingText(
  context: BriefingContext,
  deps: EngineDeps = {},
  engine?: BriefingEngine
): Promise<BriefingModelText> {
  const resolved = engine ?? (await resolveBriefingEngine(deps));
  if (resolved.kind === 'none' || !resolved.config) {
    throw new BriefingEngineError(resolved.detail);
  }

  const system = BRIEFING_SYSTEM_PROMPT;
  const user = buildBriefingUserMessage({ context });

  const primary = await completeWith(resolved, system, user);
  const first = parseBriefingReply(primary.text, context);
  if (first.ok && first.text) {
    return {
      headline: first.text.headline,
      body: first.text.body,
      recommendations: first.text.recommendations,
      model: primary.model,
      latencyMs: primary.latencyMs,
      traceability: first.traceability,
      adjustments: first.adjustments,
    };
  }

  // The reply arrived but was rejected. It is not displayed, and it is not
  // re-rolled at the same provider: the fallback gets one attempt.
  const rejection = new BriefingEngineError(
    first.reason ?? "The model's briefing could not be read.",
    first.traceability
  );
  // The fallback is asked once, and never when it already wrote the rejected reply.
  const fallback =
    resolved.kind === 'fallback'
      ? noEngine('The rejected reply came from the summary fallback itself.', 'no fallback provider')
      : resolved.fallback ?? (await resolveBriefingFallback(deps));
  if (fallback.kind !== 'fallback' || !fallback.config) {
    throw new BriefingEngineError(
      `${rejection.message} No fallback provider is available, so the computed briefing is shown instead. ${fallback.detail}`,
      first.traceability
    );
  }

  let secondary: Completion;
  try {
    secondary = await completeWith(fallback, system, user);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The fallback provider could not be reached.';
    throw new BriefingEngineError(
      `${rejection.message} The fallback provider could not be reached, so the computed briefing is shown instead. ${detail}`,
      first.traceability
    );
  }

  const second = parseBriefingReply(secondary.text, context);
  if (second.ok && second.text) {
    const destination = fallback.destination ?? 'fallback';
    return {
      headline: second.text.headline,
      body: second.text.body,
      recommendations: second.text.recommendations,
      model: secondary.model ?? fallback.model,
      latencyMs: primary.latencyMs + secondary.latencyMs,
      traceability: second.traceability,
      adjustments: [
        ...second.adjustments,
        `discarded the ${resolved.label}'s reply — ${rejection.message}`,
        `the fallback provider (${destination}) rewrote it after the number guard rejected the first reply`,
      ],
      engineKind: 'fallback',
      engineDetail: `The ${resolved.label}'s reply was discarded by the number guard; the fallback provider (${destination}) rewrote it.`,
      provider: fallback.label,
      destination: fallback.destination,
    };
  }

  throw new BriefingEngineError(
    `${rejection.message} The fallback provider's reply failed the same check, so the computed briefing is shown instead.`,
    second.traceability
  );
}