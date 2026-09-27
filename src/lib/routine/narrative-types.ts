// ── Narrative shape (shared with the browser) ───────────
//
// The path detail page shows an assessment and a next action. They are written
// by the configured model when one is available and every number in them can be
// traced to the computed figures; otherwise the computed text is shown and
// `note` says why. Import-free, so browser code may use it.

export interface NarrativeView {
  assessment: string;
  nextAction: string;
  source: 'model' | 'computed';
  model: string | null;
  /** Why the computed text is shown, or how the model text was checked. */
  note: string;
  /** True while a model narrative is being written in the background. */
  pending: boolean;
}
