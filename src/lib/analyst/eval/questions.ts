// ── The analyst evaluation set (design §12) ─────────────────
//
// 32 questions with the first calls a good model makes, as predicates. The offline test
// (eval.test.ts) runs an oracle through them; the live script (npm run analyst:eval)
// sends them to the configured model. refKey is 2026-10-08.

import { QUESTIONS_APP } from './questions.app';
import { QUESTIONS_SERIES } from './questions.series';
import { QUESTIONS_WORKOUTS } from './questions.workouts';
import type { EvalQuestion } from './types';

export const EVAL_QUESTIONS: readonly EvalQuestion[] = [...QUESTIONS_WORKOUTS, ...QUESTIONS_SERIES, ...QUESTIONS_APP];

export type { EvalCall, EvalQuestion, Pred } from './types';
export { REF_KEY } from './match';
