// ── Scoring one live question (design §12) ──────────────────
//
// Three yes/no results and nothing else: the expected tool was called, the window
// resolved to the expected one, and the final answer makes no absence claim the coverage
// index contradicts. No value, no answer text, no argument leaves this module.

import { REFERENCE_KEY } from '../../adapters/dataset';
import type { UnitSystem } from '../../prefs';
import { answerFields, auditAbsence, type AuditEntry } from '../capabilities/absence';
import { auditEntries, buildCoverageIndex } from '../capabilities/coverage-index';
import { CAPABILITIES } from '../capabilities/registry';
import { createDataAccess } from '../dataAccess';
import { capabilityContext, isOutcome } from '../tools/capability-tool';
import type { AnalystResponse } from '../types';
import { always } from './match';
import type { EvalCall, EvalQuestion } from './types';

export interface QuestionScore {
  toolCalled: boolean;
  /** null when the question names no window to match. */
  windowMatched: boolean | null;
}

export function scoreCalls(q: EvalQuestion, calls: readonly EvalCall[]): QuestionScore {
  return { toolCalled: q.called(calls), windowMatched: q.window === always ? null : q.window(calls) };
}

/** The coverage the question started with, read live, as the service builds it. */
export async function liveAuditEntries(system: UnitSystem = 'metric', env: NodeJS.ProcessEnv = process.env): Promise<AuditEntry[]> {
  const data = createDataAccess({ system, refKey: REFERENCE_KEY, env });
  const cctx = capabilityContext({ system, deps: { env }, changes: [], data });
  if (isOutcome(cctx)) return [];
  return auditEntries(CAPABILITIES, (await buildCoverageIndex(CAPABILITIES, cctx)).rows);
}

/** True when the shown answer still claims absence of something the app holds, after any lookup the model made. */
export function hasAbsenceViolation(response: Pick<AnalystResponse, 'answer'>, entries: readonly AuditEntry[], calls: readonly EvalCall[]): boolean {
  const a = response.answer;
  if (!a) return false;
  const lookups = calls.map(c => ({ tool: c.tool, ...(typeof c.args.capability === 'string' ? { capability: c.args.capability } : {}) }));
  return auditAbsence(answerFields(JSON.stringify({ analysis: a.analysis, summary: a.summary, uncertainty: a.uncertainty })), entries, lookups).length > 0;
}
