// ── AI providers and uses: shared types (no imports) ─────
//
// What a person configures in Settings: providers (Connections → AI providers)
// and, for each use, which provider and model it runs on plus its tuning
// (Preferences → AI models). Stored per user in db/migrations/0017.
//
// The browser imports the shapes and the option limits from here, so this file
// imports nothing and holds no credential.
//
// Tuning is stored sparse: a field that is absent means "the default", and the
// defaults are applied when a configuration is built (`analystTuning`,
// `summaryTuning`). `parseOptions` is the only way stored or submitted options
// are read: an unknown field is dropped and an out-of-range number is dropped
// rather than guessed at, exactly as the old environment parsing did.
//
// The system prompt and the timeouts are NOT here: they stay deployment
// settings in the environment (ANALYST_SYSTEM_PROMPT(_FILE), ANALYST_TIMEOUT_MS,
// ANALYST_QUESTION_TIMEOUT_MS, BRIEFING_TIMEOUT_MS).

export type AiProviderKind = 'openai' | 'anthropic';
export const AI_PROVIDER_KINDS: readonly AiProviderKind[] = ['openai', 'anthropic'];

export type AiUse = 'analyst' | 'summary' | 'summary_fallback';
export const AI_USES: readonly AiUse[] = ['analyst', 'summary', 'summary_fallback'];

/**
 * Bounded reasoning effort, as the gateway's `reasoning.effort` field accepts
 * it. Sent only when one is chosen: a reasoning model spends its completion
 * budget on reasoning before it writes an answer, and an unbounded effort can
 * consume the whole budget with no answer produced. Never sent when unset, so an
 * endpoint that does not know the field is never handed one.
 */
export const REASONING_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type JsonMode = 'auto' | 'off';
export type ToolsMode = 'auto' | 'off';
export type ContextMode = 'ondemand' | 'full';

// ── Defaults ────────────────────────────────────────────

export const DEFAULT_MAX_TOKENS = 1200;
export const DEFAULT_TEMPERATURE = 0.2;
/** About 15k tokens: what a small local model can hold beside the instructions and the tool definitions. */
export const DEFAULT_CONTEXT_MAX_CHARS = 60_000;
export const DEFAULT_CONTEXT_MODE: ContextMode = 'full';
/**
 * The runaway guard (analyst/guard.ts). About 10k tokens of reasoning, and a
 * reply twelve times the length of a real answer, in one model turn.
 */
export const DEFAULT_MAX_REASONING_CHARS = 40_000;
export const DEFAULT_MAX_ANSWER_CHARS = 30_000;
/**
 * Output budget for one briefing.
 *
 * Deliberately generous: a reasoning model spends `max_tokens` on its reasoning
 * *and* its reply, and the reply itself is only ~200 tokens. At 1200 the budget
 * was consumed by reasoning alone and the JSON arrived cut off mid-sentence.
 */
export const DEFAULT_BRIEFING_MAX_TOKENS = 4000;
export const DEFAULT_BRIEFING_TEMPERATURE = 0.3;

// ── Options ─────────────────────────────────────────────

/** The analyst's tuning, as stored. Every field is optional: absent means the default. */
export interface AnalystOptions {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  /** `auto` sends JSON mode and retries once without it on HTTP 400; `off` never sends it. */
  jsonMode?: JsonMode;
  /** Whether the model may call the training-plan and data tools. */
  tools?: ToolsMode;
  /** How the health data reaches the model. */
  context?: ContextMode;
  /** The most the full context may weigh, in characters, before the least relevant parts are dropped. */
  contextMaxChars?: number;
  /** Characters of reasoning one model turn may stream before the question is stopped. */
  maxReasoningChars?: number;
  /** Characters of reply one model turn may stream before the question is stopped. */
  maxAnswerChars?: number;
  /** Whether an unfamiliar lab report may be read by this model. Default on. */
  labAssist?: boolean;
}

/** The summary's tuning (also the summary fallback's). */
export interface SummaryOptions {
  maxTokens?: number;
  temperature?: number;
  /** Default: none is sent, the briefing's long-standing policy. */
  reasoningEffort?: ReasoningEffort;
}

export type AiOptions = AnalystOptions | SummaryOptions;

interface NumberLimit {
  min: number;
  max: number;
  integer: boolean;
}

/** The accepted range of every numeric option. The form shows them, and parsing enforces them. */
export const OPTION_LIMITS = {
  maxTokens: { min: 1, max: 200_000, integer: true },
  temperature: { min: 0, max: 2, integer: false },
  contextMaxChars: { min: 8000, max: 2_000_000, integer: true },
  maxReasoningChars: { min: 1000, max: 2_000_000, integer: true },
  maxAnswerChars: { min: 1000, max: 2_000_000, integer: true },
} satisfies Record<string, NumberLimit>;

type NumericOption = keyof typeof OPTION_LIMITS;

const ANALYST_NUMBERS: NumericOption[] = ['maxTokens', 'temperature', 'contextMaxChars', 'maxReasoningChars', 'maxAnswerChars'];
const SUMMARY_NUMBERS: NumericOption[] = ['maxTokens', 'temperature'];

function numberIn(value: unknown, limit: NumberLimit): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < limit.min || n > limit.max) return undefined;
  if (limit.integer && !Number.isInteger(n)) return undefined;
  return n;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * Read stored or submitted options for a use. Never throws: anything that is not
 * an accepted value is left out, so it falls back to the default.
 */
export function parseOptions(use: 'analyst', raw: unknown): AnalystOptions;
export function parseOptions(use: 'summary' | 'summary_fallback', raw: unknown): SummaryOptions;
export function parseOptions(use: AiUse, raw: unknown): AiOptions;
export function parseOptions(use: AiUse, raw: unknown): AiOptions {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of use === 'analyst' ? ANALYST_NUMBERS : SUMMARY_NUMBERS) {
    const value = numberIn(input[key], OPTION_LIMITS[key]);
    if (value !== undefined) out[key] = value;
  }
  const effort = oneOf(input.reasoningEffort, REASONING_EFFORTS);
  if (effort) out.reasoningEffort = effort;
  if (use === 'analyst') {
    const jsonMode = oneOf(input.jsonMode, ['auto', 'off'] as const);
    if (jsonMode) out.jsonMode = jsonMode;
    const tools = oneOf(input.tools, ['auto', 'off'] as const);
    if (tools) out.tools = tools;
    const context = oneOf(input.context, ['ondemand', 'full'] as const);
    if (context) out.context = context;
    if (typeof input.labAssist === 'boolean') out.labAssist = input.labAssist;
  }
  return out;
}

// ── Records ─────────────────────────────────────────────

/** Whether a provider's key can be used: none stored, readable, or written under another secret key. */
export type AiKeyState = 'none' | 'ok' | 'needs_reentry';

/** A stored provider, key decrypted. SERVER ONLY: never serialized to a browser. */
export interface AiProviderRecord {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  /** The decrypted key, or null when none is stored or it cannot be read. */
  apiKey: string | null;
  keyState: AiKeyState;
  updatedAt: string;
  revision: number;
}

/** A stored choice of provider and model for one use. */
export interface AiAssignment {
  use: AiUse;
  providerId: string;
  model: string;
  options: AiOptions;
  updatedAt: string;
  revision: number;
}

/** One user's AI configuration, as every consumer reads it. */
export interface AiSettings {
  providers: AiProviderRecord[];
  assignments: AiAssignment[];
  /** Set when a database is configured but the settings could not be read. Safe to show. */
  unavailable?: string;
}

/** The provider and model a use runs on, resolved. Null when the use has none. */
export interface AiSelection {
  provider: AiProviderRecord;
  model: string;
  options: AiOptions;
}

export function selectionFor(settings: AiSettings, use: AiUse): AiSelection | null {
  const assignment = settings.assignments.find(a => a.use === use);
  if (!assignment) return null;
  const provider = settings.providers.find(p => p.id === assignment.providerId);
  if (!provider) return null;
  return { provider, model: assignment.model, options: assignment.options };
}

/** Plain names for the uses, shared by every page that names one. */
export const AI_USE_LABELS: Record<AiUse, string> = {
  analyst: 'Analyst',
  summary: 'Summary',
  summary_fallback: 'Summary fallback',
};

export const AI_PROVIDER_KIND_LABELS: Record<AiProviderKind, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
};
