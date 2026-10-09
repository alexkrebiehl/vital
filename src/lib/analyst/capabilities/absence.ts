// ── The absence audit (design §5.5, pure) ────────────────────
//
// A reply that says "no workout records" while the app holds hundreds is the failure
// this whole design exists to fix. The prompt asks the model not to say it (the
// persuasive half); this is the mechanical half. It reads the three prose fields of
// an answer for absence claims, and a claim is a VIOLATION when the coverage index
// said the capability holds records (or cannot say) and no tool of that capability
// was called in this question. A claim made after any lookup is the model reporting
// what a tool told it, and is left alone: that includes `no_data_in_window`.

import { extractJsonObject } from '../validate';
import type { Coverage } from './types';

/** What the audit needs of a capability, with the coverage the question started with. */
export interface AuditEntry {
  id: string;
  title: string;
  tool: string;
  absenceTerms: readonly string[];
  coverage: Coverage | { kind: 'withheld' };
}

/** One tool call of the question: which tool, and what the envelope said. */
export interface Lookup {
  tool: string;
  capability?: string;
  status?: string;
}

export interface AbsenceAnswer {
  analysis?: string;
  summary?: string[];
  uncertainty?: string[];
}

export interface Violation {
  id: string;
  title: string;
  tool: string;
  coverage: Extract<Coverage, { kind: 'known' | 'unknown' }>;
  /** The sentence that made the claim, as written. */
  sentence: string;
}

/** The three fields a claim is looked for in (design §5.5). */
export function answerFields(text: string): AbsenceAnswer {
  const json = extractJsonObject(text);
  if (json) {
    try {
      const o = JSON.parse(json) as Record<string, unknown>;
      const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
      const out: AbsenceAnswer = {};
      if (typeof o.analysis === 'string') out.analysis = o.analysis;
      const summary = list(o.summary);
      if (summary) out.summary = summary;
      const uncertainty = list(o.uncertainty);
      if (uncertainty) out.uncertainty = uncertainty;
      return out;
    } catch {
      // Not JSON after all: read it as written.
    }
  }
  return { analysis: text };
}

// ── The detector ────────────────────────────────────────────

/** The ways a reply says "there is no": folded to the one form the capability terms are written in. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bnone of (?:the |your |these |those )?/g, 'no ')
    .replace(/\b(?:isn't|aren't|wasn't|weren't) any\b/g, 'no')
    .replace(/\b(?:is|are|was|were) not any\b/g, 'no')
    .replace(/\bnot any\b/g, 'no')
    .replace(/\b(?:does not|doesn't|do not|don't) (?:contain|include|hold|have)(?: any)?\b/g, 'contains no')
    .replace(/\s+/g, ' ');
}

/** Terms with no subject of their own ("not recorded", "no data"): they count only beside a word of the capability. */
const GENERIC_REST: readonly string[] = ['data', 'records', 'readings', 'recorded', 'nothing recorded'];
const TOPIC_STOP: readonly string[] = ['summary', 'summaries', 'series', 'comparison', 'period'];

function isGeneric(term: string): boolean {
  return GENERIC_REST.includes(term.replace(/^(?:no|not) /, ''));
}

/** The words of a capability's title a generic claim must be about. */
function topics(title: string): RegExp[] {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(w => w.length >= 3 && !TOPIC_STOP.includes(w))
    .map(w => new RegExp(`\\b${w.replace(/(?:ies|es|s)$/, '')}`));
}

const SENTENCES = /(?<=[.!?])\s+|\n+/;

function claimIn(sentence: string, entry: AuditEntry): boolean {
  const folded = fold(sentence);
  return entry.absenceTerms.some(raw => {
    const term = fold(raw);
    if (!term || !folded.includes(term)) return false;
    return !isGeneric(term) || topics(entry.title).some(t => t.test(folded));
  });
}

function sentencesOf(answer: AbsenceAnswer): string[] {
  const parts = [answer.analysis ?? '', ...(answer.summary ?? []), ...(answer.uncertainty ?? [])];
  return parts.flatMap(p => p.split(SENTENCES)).map(s => s.trim()).filter(Boolean);
}

// ── The rule ────────────────────────────────────────────────

/** The absence claims of an answer that are violations, in registry order, at most one per capability. */
export function auditAbsence(answer: AbsenceAnswer, entries: readonly AuditEntry[], lookups: readonly Lookup[]): Violation[] {
  const sentences = sentencesOf(answer);
  const out: Violation[] = [];
  for (const e of entries) {
    const c = e.coverage;
    if (c.kind === 'withheld' || c.kind === 'unavailable') continue;
    if (c.kind === 'known' && c.count <= 0) continue;
    if (lookups.some(l => l.tool === e.tool || l.capability === e.id)) continue;
    const sentence = sentences.find(s => claimIn(s, e));
    if (sentence) out.push({ id: e.id, title: e.title, tool: e.tool, coverage: c, sentence });
  }
  return out;
}

// ── What is said about it ───────────────────────────────────

/** One violation per tool: get_workouts serves two capabilities and needs saying once. */
function perTool(violations: readonly Violation[]): Violation[] {
  const seen = new Set<string>();
  return violations.filter(v => (seen.has(v.tool) ? false : (seen.add(v.tool), true)));
}

function held(c: Violation['coverage']): string {
  if (c.kind === 'unknown') return 'The app cannot say how many it holds until you fetch them.';
  const span = c.first && c.last ? ` from ${c.first} to ${c.last}` : '';
  return `The app holds ${c.count} ${c.unit}${span}.`;
}

/** The one corrective turn sent to a model that has tools (design §5.5). */
export function correctiveTurn(violations: readonly Violation[]): string {
  const list = perTool(violations);
  const claims = list.map(v => `Your answer says there are no ${v.title} records. ${held(v.coverage)}`);
  const tools = [...new Set(list.map(v => v.tool))].join(', ');
  return `${claims.join(' ')} Fetch them with ${tools} before answering, then answer again in the same JSON shape.`;
}

/** The line the app adds to `uncertainty` when the model has no tools: computed, so it needs no grounding. */
export function appUncertaintyLine(v: Violation): string {
  const c = v.coverage;
  if (c.kind === 'unknown') return `The app may hold ${v.title} that were not part of this answer; how many is not known without fetching them.`;
  const span = c.first && c.last ? ` from ${c.first} to ${c.last}` : '';
  return `The app holds ${c.count} ${v.title}${span} that were not part of this answer.`;
}

/** The lines for a set of violations, once per tool. */
export function appUncertaintyLines(violations: readonly Violation[]): string[] {
  return perTool(violations).map(appUncertaintyLine);
}
