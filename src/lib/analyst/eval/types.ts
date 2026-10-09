// ── The analyst evaluation set: shapes (design §12) ─────────

/** One tool call: the tool and the arguments the model sent. */
export interface EvalCall {
  tool: string;
  args: Record<string, unknown>;
}

/** A judgement on the calls a model made for one question. */
export type Pred = (calls: readonly EvalCall[]) => boolean;

export interface EvalQuestion {
  n: number;
  text: string;
  /** Tools whose use counts as "the expected tool was called" (alternatives allowed). */
  tools: readonly string[];
  /** The expected tool, with the argument checks that are not about the window. */
  called: Pred;
  /** The expected month, day or span: true when the window of the calls matches. */
  window: Pred;
  /** The calls an oracle model issues; they must satisfy both predicates. */
  oracle: readonly EvalCall[];
  /** What every oracle call must answer: `ok` unless the question is about missing data. */
  status?: 'ok' | 'no_data_in_window';
  /** The oracle's answer. It carries no figure of its own; Q32 quotes the coverage its lookup returned. */
  answer: string | ((results: readonly unknown[]) => string);
}
