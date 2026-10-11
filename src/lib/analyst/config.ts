// ── Model configuration (SPEC §8, §11) ──────────────────
//
// The single place where a provider, a model and its tuning become the
// configuration a provider is built from (`AnalystConfig`).
//
// Where each part comes from:
//   * the provider (protocol, address, key), the model and the tuning are chosen
//     in Settings and stored per user (src/lib/ai). They arrive here as an
//     `AiSelection`; `resolveAnalystConfig` (./resolve-config) reads them.
//   * the system prompt and the timeouts stay deployment settings in the server
//     environment (ANALYST_SYSTEM_PROMPT(_FILE), ANALYST_TIMEOUT_MS,
//     ANALYST_QUESTION_TIMEOUT_MS).
//
// Why it is written this way:
//   * every value is injected. `buildAnalystConfig(selection, env)` takes both as
//     arguments, so tests never read the database or the real process env.
//   * nothing here throws. A bad value becomes a stated `misconfiguredReason`
//     that the UI can show, never a crash.
//   * nothing here returns a credential. The key is reduced to `apiKey` (handed
//     straight to fetch()) plus a `hasKey` boolean; the API surface exposes only
//     the boolean.
//   * the system prompt file is re-read when its mtime changes, so editing a
//     mounted prompt takes effect on the next request without a restart.

import { ALWAYS_SENT, sendingSentences } from './capabilities/categories';
import { CAPABILITY_MANIFEST } from './capabilities/manifest';
import type { CapabilityManifestEntry } from './capabilities/types';
import { statSync, readFileSync } from 'node:fs';
import { DEFAULT_ANALYST_SYSTEM_PROMPT } from './systemPrompt';
import {
  AI_USE_LABELS,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_CONTEXT_MODE,
  DEFAULT_MAX_ANSWER_CHARS,
  DEFAULT_MAX_REASONING_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  type AiSelection,
  type AiUse,
  type AnalystOptions,
  type ContextMode,
  type JsonMode,
  type ReasoningEffort,
  type ToolsMode,
} from '@/lib/ai/types';

export {
  REASONING_EFFORTS,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_CONTEXT_MODE,
  DEFAULT_MAX_ANSWER_CHARS,
  DEFAULT_MAX_REASONING_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  type JsonMode,
  type ReasoningEffort,
} from '@/lib/ai/types';

export type AnalystProviderId = 'demo' | 'openai' | 'anthropic';
export type SystemPromptSource = 'built-in' | 'custom';

/** Provider default request path, appended when the configured URL omits it. */
export const PROVIDER_DEFAULT_PATHS: Record<Exclude<AnalystProviderId, 'demo'>, string> = {
  openai: '/chat/completions',
  anthropic: '/v1/messages',
};

/** Human label shown in the UI. Never contains a key or a model id. */
export const PROVIDER_DISPLAY_NAMES: Record<AnalystProviderId, string> = {
  demo: 'Demo analyst',
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
};

/**
 * Hosts that are considered to stay on this machine. A local model server
 * (LM Studio, llama.cpp, Ollama, vLLM) is reachable over one of these and needs
 * no credential. `host.docker.internal` is included because from inside a
 * container it resolves to the host, not the internet.
 */
export const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  'host.docker.internal',
]);

/** Five minutes for one whole question, tool rounds included (guard.ts). */
export const DEFAULT_QUESTION_TIMEOUT_MS = 300_000;
export const DEFAULT_TIMEOUT_MS = 60000;

/**
 * What a remote provider receives, in plain sentences, built from the categories of the
 * capabilities offered (capabilities/manifest.ts) so the list cannot fall behind the
 * registry. Always ends with what is sent whatever the capabilities: the question and the
 * coverage statements.
 */
export function remoteSendingCategories(entries: readonly Pick<CapabilityManifestEntry, 'category'>[]): string[] {
  return [...sendingSentences(entries.map(e => e.category)), ALWAYS_SENT];
}

/** Categories of health context a remote provider receives. */
export const REMOTE_SENDING_CATEGORIES: string[] = remoteSendingCategories(CAPABILITY_MANIFEST);

export interface AnalystConfig {
  /** Resolved provider id. An unrecognised name resolves to 'demo' but is still reported as misconfigured. */
  provider: AnalystProviderId;
  /** Display label: the name the provider was given in Settings, or "Demo analyst". */
  providerDisplayName: string;
  model: string | null;
  /** Normalized absolute request URL (provider default path appended when missing). */
  endpoint: string | null;
  /** Host only, for display. Never the full URL if it carried credentials. */
  endpointHost: string | null;
  endpointLoopback: boolean;
  /** Server-only credential. Never serialized into a response or a log. */
  apiKey: string | null;
  hasKey: boolean;
  systemPrompt: string;
  systemPromptSource: SystemPromptSource;
  systemPromptFile: string | null;
  /** Set when a configured prompt file could not be read; the built-in prompt is used instead. */
  systemPromptWarning: string | null;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonMode: JsonMode;
  /** Whether a remote model may call the training-plan tools (off for servers without tool calling). */
  tools: ToolsMode;
  /**
   * How the health data reaches the model. `ondemand`: a short index of what exists,
   * and the model fetches what the question needs with read tools. `full`: the whole
   * selection is sent with every question (also the fallback when tools are off or
   * refused).
   */
  context: ContextMode;
  /** The most the fixed (full) context may weigh, in characters, before the least relevant parts are dropped and named. */
  contextMaxChars: number;
  /** Characters of reasoning one model turn may stream before the question is stopped. */
  maxReasoningChars: number;
  /** Characters of reply text one model turn may stream before the question is stopped. */
  maxAnswerChars: number;
  /** The wall clock for one whole question, tool rounds included. */
  questionTimeoutMs: number;
  /** Reasoning effort to request, or null when the endpoint is not told one. */
  reasoningEffort: ReasoningEffort | null;
  sendingCategories: string[];
  /** Whether an unfamiliar lab report may be read by this model (Settings; default on). */
  labAssist: boolean;
  /** Human explanation of why this configuration cannot be used, or null when it is usable. */
  misconfiguredReason: string | null;
}

// ── Endpoint handling ───────────────────────────────────

/** True when a hostname stays on this machine (see LOOPBACK_HOSTS). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export interface NormalizedEndpoint {
  url: string | null;
  host: string | null;
  loopback: boolean;
  reason: string | null;
}

/**
 * Turn a provider's base URL into a request URL.
 *
 * A base URL (`https://openrouter.ai/api/v1`) gets the provider's default path
 * appended; a full endpoint that already ends in that path is used as-is. An
 * unparseable value, or a scheme that is not http(s), yields a reason instead of
 * throwing.
 */
export function normalizeEndpoint(raw: string, provider: Exclude<AnalystProviderId, 'demo'>): NormalizedEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, host: null, loopback: false, reason: 'The provider has no address.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, host: null, loopback: false, reason: 'The provider address is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, host: null, loopback: false, reason: 'The provider address must use http or https.' };
  }

  const defaultPath = PROVIDER_DEFAULT_PATHS[provider];
  const bare = parsed.pathname.replace(/\/+$/, '');
  const full = bare.endsWith(defaultPath)
    ? bare
    : // Anthropic's default path is /v1/messages; a base URL that already carries
      // /v1 (https://api.anthropic.com/v1) must not become /v1/v1/messages.
      provider === 'anthropic' && bare.endsWith('/v1')
      ? `${bare}/messages`
      : `${bare}${defaultPath}`;
  parsed.pathname = full || defaultPath;
  parsed.search = '';
  parsed.hash = '';

  return {
    url: parsed.toString(),
    host: parsed.host,
    loopback: isLoopbackHost(parsed.hostname),
    reason: null,
  };
}

// ── System prompt resolution ────────────────────────────

interface PromptFileCacheEntry {
  mtimeMs: number;
  size: number;
  text: string;
}

/** Per-path cache so a mounted prompt file is only re-read when it changes. */
const promptFileCache = new Map<string, PromptFileCacheEntry>();

/**
 * Read a prompt file, re-reading it only when its mtime or size changed.
 * Returns an error string instead of throwing when the file cannot be read.
 */
export function readSystemPromptFile(path: string): { text: string | null; error: string | null } {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { text: null, error: `ANALYST_SYSTEM_PROMPT_FILE points at ${path}, which is not a file.` };
    const cached = promptFileCache.get(path);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { text: cached.text, error: null };
    }
    const text = readFileSync(path, 'utf8');
    promptFileCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return { text, error: null };
  } catch {
    // The message deliberately carries the path only: the file may be missing,
    // unreadable or outside the mount, and none of that should crash a request.
    return { text: null, error: `ANALYST_SYSTEM_PROMPT_FILE (${path}) could not be read, so the built-in prompt is in use.` };
  }
}

/** Test/ops helper: forget the cached contents of every prompt file. */
export function clearPromptFileCache(): void {
  promptFileCache.clear();
}

export interface SystemPromptResolution {
  prompt: string;
  source: SystemPromptSource;
  file: string | null;
  warning: string | null;
}

/**
 * Resolve the system prompt. Precedence: file > inline > built-in.
 * A configured-but-unreadable file falls back to the inline prompt (or the
 * built-in one) and reports why — it never silently becomes the built-in prompt
 * without a warning.
 */
export function resolveSystemPrompt(env: NodeJS.ProcessEnv): SystemPromptResolution {
  const file = env.ANALYST_SYSTEM_PROMPT_FILE?.trim();
  const inline = env.ANALYST_SYSTEM_PROMPT?.trim();

  if (file) {
    const read = readSystemPromptFile(file);
    if (read.text !== null && read.text.trim().length > 0) {
      return { prompt: read.text.trim(), source: 'custom', file, warning: null };
    }
    if (inline) return { prompt: inline, source: 'custom', file, warning: read.error };
    return { prompt: DEFAULT_ANALYST_SYSTEM_PROMPT, source: 'built-in', file, warning: read.error };
  }

  if (inline) return { prompt: inline, source: 'custom', file: null, warning: null };
  return { prompt: DEFAULT_ANALYST_SYSTEM_PROMPT, source: 'built-in', file: null, warning: null };
}

// ── Tuning ──────────────────────────────────────────────

/** Every request parameter a provider is built with, defaults applied. */
export interface ModelTuning {
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonMode: JsonMode;
  tools: ToolsMode;
  context: ContextMode;
  contextMaxChars: number;
  maxReasoningChars: number;
  maxAnswerChars: number;
  questionTimeoutMs: number;
  reasoningEffort: ReasoningEffort | null;
}

/** A bounded number from the environment, or the fallback. Only the timeouts are still read this way. */
export function envNumber(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

/** The analyst's tuning: the options chosen in Settings, defaults for the rest, timeouts from the environment. */
export function analystTuning(options: AnalystOptions, env: NodeJS.ProcessEnv = process.env): ModelTuning {
  return {
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: envNumber(env, 'ANALYST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100, 600000),
    jsonMode: options.jsonMode ?? 'auto',
    tools: options.tools ?? 'auto',
    context: options.context ?? DEFAULT_CONTEXT_MODE,
    contextMaxChars: options.contextMaxChars ?? DEFAULT_CONTEXT_MAX_CHARS,
    maxReasoningChars: options.maxReasoningChars ?? DEFAULT_MAX_REASONING_CHARS,
    maxAnswerChars: options.maxAnswerChars ?? DEFAULT_MAX_ANSWER_CHARS,
    questionTimeoutMs: envNumber(env, 'ANALYST_QUESTION_TIMEOUT_MS', DEFAULT_QUESTION_TIMEOUT_MS, 1000, 1_800_000),
    reasoningEffort: options.reasoningEffort ?? null,
  };
}

// ── Builders ────────────────────────────────────────────

const PROVIDERS_HINT = 'Settings → Connections → AI providers';
const MODELS_HINT = 'Settings → Preferences → AI models';

export interface BuildExtras {
  /** Whether the lab second pass may use this model. */
  labAssist?: boolean;
}

/**
 * Build the configuration one use runs with.
 *
 * With no selection this is the demo configuration and nothing touches the
 * network. With one, it validates the address, the model and (for a host that is
 * not on this machine) the key, and states the first problem it finds as
 * `misconfiguredReason`, naming where in Settings to fix it.
 */
export function buildModelConfig(
  selection: AiSelection | null,
  tuning: ModelTuning,
  prompt: SystemPromptResolution,
  use: AiUse,
  extras: BuildExtras = {}
): AnalystConfig {
  const shared = {
    systemPrompt: prompt.prompt,
    systemPromptSource: prompt.source,
    systemPromptFile: prompt.file,
    systemPromptWarning: prompt.warning,
    ...tuning,
    labAssist: extras.labAssist ?? true,
  };

  if (!selection) {
    return {
      ...shared,
      provider: 'demo',
      providerDisplayName: PROVIDER_DISPLAY_NAMES.demo,
      model: null,
      endpoint: null,
      endpointHost: null,
      endpointLoopback: false,
      apiKey: null,
      hasKey: false,
      sendingCategories: [],
      misconfiguredReason: null,
    };
  }

  const { provider } = selection;
  const model = selection.model.trim() || null;
  const endpoint = normalizeEndpoint(provider.baseUrl, provider.kind);
  const name = `“${provider.name}”`;
  const useLabel = AI_USE_LABELS[use];

  const reason =
    (endpoint.reason ? `${endpoint.reason} Fix ${name} in ${PROVIDERS_HINT}.` : null) ??
    (provider.keyState === 'needs_reentry'
      ? `The API key stored for ${name} cannot be read with this server's secret key. Enter it again in ${PROVIDERS_HINT}.`
      : null) ??
    (!model ? `No model is chosen for the ${useLabel}. Choose one in ${MODELS_HINT}.` : null) ??
    (!endpoint.loopback && !provider.apiKey
      ? `${name} needs an API key because it is not on this machine. Add one in ${PROVIDERS_HINT}.`
      : null);

  return {
    ...shared,
    provider: provider.kind,
    providerDisplayName: provider.name,
    model,
    endpoint: endpoint.url,
    endpointHost: endpoint.host,
    endpointLoopback: endpoint.loopback,
    apiKey: provider.apiKey,
    hasKey: Boolean(provider.apiKey),
    sendingCategories: REMOTE_SENDING_CATEGORIES,
    misconfiguredReason: reason,
  };
}

/**
 * The analyst's configuration for a selection (null: the demo analyst). The
 * system prompt and the timeouts are read from `env`.
 */
export function buildAnalystConfig(selection: AiSelection | null, env: NodeJS.ProcessEnv = process.env): AnalystConfig {
  const options = (selection?.options ?? {}) as AnalystOptions;
  return buildModelConfig(selection, analystTuning(options, env), resolveSystemPrompt(env), 'analyst', {
    labAssist: options.labAssist ?? true,
  });
}

/** The demo configuration with a stated reason it is not usable (the settings could not be read). */
export function unavailableAnalystConfig(reason: string, env: NodeJS.ProcessEnv = process.env): AnalystConfig {
  return { ...buildAnalystConfig(null, env), misconfiguredReason: reason };
}

/** Whether the lab second pass may run on this configuration. */
export function labAssistAllowed(config: AnalystConfig): boolean {
  return config.provider !== 'demo' && config.misconfiguredReason === null && config.labAssist;
}

/** Configuration state safe to return to a browser: never a key, never a full URL with credentials. */
export interface AnalystConfigState {
  configured: boolean;
  misconfigured: boolean;
  misconfiguredReason: string | null;
  provider: AnalystProviderId;
  providerDisplayName: string;
  model: string | null;
  destination: string | null;
  hasKey: boolean;
  endpointIsLoopback: boolean;
  /** Reasoning effort requested of the model, or null when none is sent. */
  reasoningEffort: ReasoningEffort | null;
  sendingCategories: string[];
  systemPromptSource: SystemPromptSource;
  systemPromptWarning: string | null;
}

/** Reduce a resolved configuration to the fields the client may see. */
export function publicConfigState(config: AnalystConfig): AnalystConfigState {
  const configured = config.provider !== 'demo' && config.misconfiguredReason === null;
  return {
    configured,
    misconfigured: config.misconfiguredReason !== null,
    misconfiguredReason: config.misconfiguredReason,
    provider: config.provider,
    providerDisplayName: config.providerDisplayName,
    model: config.model,
    destination: config.endpointHost,
    hasKey: config.hasKey,
    endpointIsLoopback: config.endpointLoopback,
    reasoningEffort: config.reasoningEffort,
    sendingCategories: config.provider === 'demo' ? [] : config.sendingCategories,
    systemPromptSource: configured ? config.systemPromptSource : 'built-in',
    systemPromptWarning: config.systemPromptWarning,
  };
}
