// ── The runaway guard for one streamed question (SERVER ONLY) ──
//
// A reasoning model can fail to stop: it keeps "thinking" (or writing an answer) with no
// end, and a plain token budget is far too high to catch it in time. The guard bounds
// the three things a stream can do without end, and stops the question with a message
// that says which limit was hit and how to change it (the failed turn stays in the thread, like
// any other error; no answer is stored):
//
//   reasoning   characters of reasoning in ONE model turn
//   answer      characters of reply text in ONE model turn
//   time        the wall clock for the WHOLE question, tool rounds included
//
// Nothing here is a timeout on the connection: a model that is still producing a
// reasonable amount of text for a long time is left alone until the deadline.

import { AnalystProviderError } from './provider';

export interface GuardLimits {
  maxReasoningChars: number;
  maxAnswerChars: number;
  questionTimeoutMs: number;
}

export class StreamGuard {
  private reasoningInTurn = 0;
  private answerInTurn = 0;
  private readonly deadline: number;
  private stopped: string | null = null;

  constructor(
    private readonly limits: GuardLimits,
    private readonly now: () => number = Date.now
  ) {
    this.deadline = now() + limits.questionTimeoutMs;
  }

  /** Why the question was stopped, once it was. */
  get reason(): string | null {
    return this.stopped;
  }

  /** Milliseconds left before the question's deadline. */
  remainingMs(): number {
    return Math.max(0, this.deadline - this.now());
  }

  /** Start a model turn: the per-turn counters reset, and a past deadline stops the question. */
  beginTurn(): void {
    this.reasoningInTurn = 0;
    this.answerInTurn = 0;
    if (this.remainingMs() <= 0) this.expire();
  }

  reasoning(text: string): void {
    this.reasoningInTurn += text.length;
    if (this.reasoningInTurn > this.limits.maxReasoningChars) {
      this.trip(
        `The model kept reasoning for more than ${this.limits.maxReasoningChars.toLocaleString('en-US')} characters without reaching an answer, so the question was stopped and no answer was produced. Ask a narrower question, lower ANALYST_REASONING_EFFORT, or raise ANALYST_MAX_REASONING_CHARS.`
      );
    }
  }

  answer(text: string): void {
    this.answerInTurn += text.length;
    if (this.answerInTurn > this.limits.maxAnswerChars) {
      this.trip(
        `The model's reply ran past ${this.limits.maxAnswerChars.toLocaleString('en-US')} characters, far more than an answer needs, so the question was stopped and no answer was produced. Ask a narrower question or raise ANALYST_MAX_ANSWER_CHARS.`
      );
    }
  }

  /** The deadline passed. Called by the timer that aborts a stalled or endless stream. */
  expire(): never {
    return this.trip(
      `The question ran past its ${Math.round(this.limits.questionTimeoutMs / 1000)}-second limit and was stopped, so no answer was produced. Ask a narrower question or raise ANALYST_QUESTION_TIMEOUT_MS.`
    );
  }

  private trip(message: string): never {
    this.stopped ??= message;
    throw new AnalystProviderError(this.stopped);
  }

  /** Record a stop from outside the stream (the deadline timer), without throwing there. */
  markExpired(): void {
    try {
      this.expire();
    } catch {
      /* recorded in `reason`; the aborted stream reports it */
    }
  }
}
