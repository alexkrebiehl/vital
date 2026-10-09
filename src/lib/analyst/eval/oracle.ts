// ── The oracle: a model that issues a question's expected calls ─────────────
//
// It goes through `runTool`, the path a real model's calls take: argument checking,
// the privacy gate, the capability, the scrub. Its answer is written by the question.

import { runTool, type ToolContext } from '../tools';
import type { Lookup } from '../capabilities/absence';
import type { EvalQuestion } from './types';

export interface OracleCall {
  tool: string;
  isError: boolean;
  /** The envelope's status; `ok` for a tool that has no envelope and did not fail. */
  status: string;
  body: Record<string, any>;
  /** The JSON text the model was handed (the grounding check reads it). */
  text: string;
}

export interface OracleRun {
  calls: OracleCall[];
  /** The model's final reply: the analyst's JSON object. */
  reply: string;
  lookups: Lookup[];
}

export async function runOracle(q: EvalQuestion, ctx: ToolContext): Promise<OracleRun> {
  const calls: OracleCall[] = [];
  for (const c of q.oracle) {
    const out = await runTool(c.tool, c.args, ctx);
    const body = JSON.parse(out.content.replace(/… \[truncated\]$/, '')) as Record<string, any>;
    calls.push({ tool: c.tool, isError: out.isError, status: out.isError ? String(body.status ?? 'error') : String(body.status ?? 'ok'), body, text: out.content });
  }
  const analysis = typeof q.answer === 'function' ? q.answer(calls.map(c => c.body)) : q.answer;
  const reply = JSON.stringify({ title: `Question ${q.n}`, analysis, recommendations: [], summary: [], uncertainty: [], evidence: [], followUps: [] });
  const lookups = calls.map(c => ({ tool: c.tool, ...(c.body.capability ? { capability: String(c.body.capability) } : {}), status: c.status }));
  return { calls, reply, lookups };
}
