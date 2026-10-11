// ── Settings → Preferences → AI models: state and the calls ─────────────
//
// Pure helpers behind the card: the fields each use offers, turning a stored
// choice into form values and back, and the save call.

import type { AiAssignmentsBody, AiAssignmentStatus } from '@/lib/ai/connect';
import {
  DEFAULT_BRIEFING_MAX_TOKENS,
  DEFAULT_BRIEFING_TEMPERATURE,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_MAX_ANSWER_CHARS,
  DEFAULT_MAX_REASONING_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  OPTION_LIMITS,
  REASONING_EFFORTS,
  type AiUse,
} from '@/lib/ai/types';

export type { AiAssignmentsBody, AiAssignmentStatus };

export const AI_ASSIGNMENTS_PATH = '/api/ai/assignments';
export const modelsPath = (providerId: string) => `/api/ai/providers/${encodeURIComponent(providerId)}/models`;

/** One Advanced field. A blank value means the default, which is shown as the placeholder. */
export type OptionField =
  | { key: string; label: string; type: 'number'; placeholder: string; min: number; max: number; step: number }
  | { key: string; label: string; type: 'select'; choices: { value: string; label: string }[] };

const effortField: OptionField = {
  key: 'reasoningEffort',
  label: 'Reasoning effort',
  type: 'select',
  choices: [{ value: '', label: 'Not sent (default)' }, ...REASONING_EFFORTS.map(e => ({ value: e, label: e }))],
};

function numberField(key: keyof typeof OPTION_LIMITS, label: string, fallback: number): OptionField {
  const limit = OPTION_LIMITS[key];
  return { key, label, type: 'number', placeholder: String(fallback), min: limit.min, max: limit.max, step: limit.integer ? 1 : 0.1 };
}

/** The Advanced fields each use offers, in order. */
export const OPTION_FIELDS: Record<AiUse, OptionField[]> = {
  analyst: [
    effortField,
    numberField('maxTokens', 'Reply budget (tokens)', DEFAULT_MAX_TOKENS),
    numberField('temperature', 'Temperature', DEFAULT_TEMPERATURE),
    {
      key: 'context',
      label: 'How your data is sent',
      type: 'select',
      choices: [
        { value: '', label: 'Everything the question needs, in one message (default)' },
        { value: 'ondemand', label: 'A list of what exists; the model asks for what it needs' },
      ],
    },
    numberField('contextMaxChars', 'Most data sent with one question (characters)', DEFAULT_CONTEXT_MAX_CHARS),
    {
      key: 'tools',
      label: 'Tools',
      type: 'select',
      choices: [
        { value: '', label: 'Allowed (default)' },
        { value: 'off', label: 'Off, for a server without tool calling' },
      ],
    },
    {
      key: 'jsonMode',
      label: 'JSON replies',
      type: 'select',
      choices: [
        { value: '', label: 'Ask for JSON (default)' },
        { value: 'off', label: 'Off, for a server that refuses it' },
      ],
    },
    numberField('maxReasoningChars', 'Reasoning limit per turn (characters)', DEFAULT_MAX_REASONING_CHARS),
    numberField('maxAnswerChars', 'Reply limit per turn (characters)', DEFAULT_MAX_ANSWER_CHARS),
  ],
  summary: [
    effortField,
    numberField('maxTokens', 'Reply budget (tokens)', DEFAULT_BRIEFING_MAX_TOKENS),
    numberField('temperature', 'Temperature', DEFAULT_BRIEFING_TEMPERATURE),
  ],
  summary_fallback: [
    effortField,
    numberField('maxTokens', 'Reply budget (tokens)', DEFAULT_BRIEFING_MAX_TOKENS),
    numberField('temperature', 'Temperature', DEFAULT_BRIEFING_TEMPERATURE),
  ],
};

/** What each use is for, in one plain line. */
export const USE_DESCRIPTIONS: Record<AiUse, string> = {
  analyst: 'Answers your questions on the Analyst page.',
  summary: "Writes today's briefing on the Overview and the training notes.",
  summary_fallback:
    "Writes the summary when the summary model can't be reached, and rewrites it once when its reply fails the number check.",
};

/** The form's values for one use. Every option is a string so a blank field means the default. */
export interface UseDraft {
  providerId: string;
  model: string;
  options: Record<string, string>;
  labAssist: boolean;
  revision: number;
}

export function draftFromStatus(status: AiAssignmentStatus | null): UseDraft {
  if (!status) return { providerId: '', model: '', options: {}, labAssist: true, revision: 0 };
  const options: Record<string, string> = {};
  let labAssist = true;
  for (const [key, value] of Object.entries(status.options)) {
    if (key === 'labAssist') labAssist = value !== false;
    else if (value !== undefined && value !== null) options[key] = String(value);
  }
  return { providerId: status.providerId, model: status.model, options, labAssist, revision: status.revision };
}

/** The options to send: only the fields that were filled in (the server checks each one). */
export function optionsToSend(use: AiUse, draft: UseDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of OPTION_FIELDS[use]) {
    const raw = draft.options[field.key]?.trim();
    if (!raw) continue;
    out[field.key] = field.type === 'number' ? Number(raw) : raw;
  }
  if (use === 'analyst' && !draft.labAssist) out.labAssist = false;
  return out;
}

/** Whether a typed number is outside its field's range (shown next to the field, and blocks Save). */
export function fieldProblem(field: OptionField, raw: string | undefined): string | null {
  if (field.type !== 'number') return null;
  const value = raw?.trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < field.min || n > field.max) return `Between ${field.min} and ${field.max}.`;
  if (field.step === 1 && !Number.isInteger(n)) return 'A whole number.';
  return null;
}

export function canSaveUse(use: AiUse, draft: UseDraft): boolean {
  if (draft.providerId && !draft.model.trim()) return false;
  return OPTION_FIELDS[use].every(field => fieldProblem(field, draft.options[field.key]) === null);
}

export type SaveUseResult =
  | { ok: true; body: AiAssignmentsBody }
  | { ok: false; message: string; current?: AiAssignmentStatus | null };

export async function saveUse(use: AiUse, draft: UseDraft, fetchImpl: typeof fetch = fetch): Promise<SaveUseResult> {
  const body = draft.providerId
    ? { use, providerId: draft.providerId, model: draft.model.trim(), options: optionsToSend(use, draft), revision: draft.revision }
    : { use, providerId: null, revision: draft.revision };
  let res: Response;
  try {
    res = await fetchImpl(AI_ASSIGNMENTS_PATH, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'The choice could not be saved: Vital could not be reached.' };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok && payload && typeof payload === 'object') return { ok: true, body: payload as AiAssignmentsBody };
  const p = (payload ?? {}) as { error?: unknown; current?: AiAssignmentStatus | null };
  return {
    ok: false,
    message: typeof p.error === 'string' ? p.error : `The choice could not be saved (HTTP ${res.status}).`,
    ...(res.status === 409 ? { current: p.current ?? null } : {}),
  };
}
