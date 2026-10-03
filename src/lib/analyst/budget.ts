// ── The size budget for the fixed (full) context ────────
//
// The full context is the whole selection sent with every question, and it has grown
// past what some models hold. A model that is over its window does not refuse: some
// servers keep the start and the end of a prompt and silently drop the middle, which
// is where the data sits. So the app never sends more than it has measured fits.
//
// When the context is over the budget, whole parts are removed in a fixed order —
// least relevant first — and the removal is STATED in the context itself, so the
// model says "I was not given X" instead of "X is not recorded". Nothing is cut in
// the middle of a value. The question and the conversation are never trimmed here.

import type { UnitSystem } from '../prefs';
import { isLabQuestion } from './questionKind';
import { buildContextPayload } from './systemPrompt';
import type { RetrievalBundle } from './types';

export interface BudgetResult {
  bundle: RetrievalBundle;
  /** Characters of the serialized context after trimming. */
  chars: number;
  /** What was removed, in the order it happened. Empty when nothing was. */
  dropped: string[];
}

const sizeOf = (bundle: RetrievalBundle, system: UnitSystem) => JSON.stringify(buildContextPayload(bundle, system)).length;

/** Fit `bundle` inside `maxChars`, naming what was left out. */
export function fitToBudget(bundle: RetrievalBundle, system: UnitSystem, maxChars: number, question: string): BudgetResult {
  let current = bundle;
  const dropped: string[] = [];
  const labFirst = isLabQuestion(question);
  let chars = sizeOf(current, system);
  if (chars <= maxChars) return { bundle, chars, dropped };

  // Each step removes one whole part; the order follows what the question is about.
  const steps: { name: string; apply: (b: RetrievalBundle) => RetrievalBundle | null }[] = [];
  const dropMetricSeries = (b: RetrievalBundle) =>
    b.summaries.some(s => s.points.length > 0)
      ? { ...b, summaries: b.summaries.map(s => ({ ...s, points: [], truncated: s.points.length > 0 })) }
      : null;
  const dropLabHistory = (b: RetrievalBundle) =>
    b.lab?.available && b.lab.series.some(s => s.history.length > 0)
      ? { ...b, lab: { ...b.lab, series: b.lab.series.map(s => ({ ...s, history: [], display: Object.fromEntries(Object.entries(s.display).filter(([k]) => k !== 'history')) })) } }
      : null;
  const dropAllMetrics = (b: RetrievalBundle) => (b.summaries.length > 0 ? { ...b, summaries: [], pairs: [], workouts: null } : null);
  const trimLabSeries = (b: RetrievalBundle) => {
    if (!b.lab?.available || b.lab.series.length <= 12) return null;
    const keep = b.lab.series.slice(0, Math.max(12, Math.floor(b.lab.series.length / 2)));
    const out = b.lab.series.slice(keep.length).map(s => s.displayName);
    return {
      ...b,
      lab: { ...b.lab, series: keep, shownSeries: keep.length, capped: true, notIncludedSeries: [...b.lab.notIncludedSeries, ...out], note: `${b.lab.note}; ${out.length} more series were left out to fit the size limit` },
    };
  };
  const dropMedications = (b: RetrievalBundle) => (b.medications ? { ...b, medications: null } : null);

  if (labFirst) {
    steps.push({ name: 'the daily series of every metric', apply: dropMetricSeries });
    steps.push({ name: 'the metric summaries (the question is about lab results)', apply: dropAllMetrics });
    steps.push({ name: 'the medication log', apply: dropMedications });
    steps.push({ name: 'the earlier observations of each lab series', apply: dropLabHistory });
    steps.push({ name: 'half of the lab series', apply: trimLabSeries });
  } else {
    steps.push({ name: 'the earlier observations of each lab series', apply: dropLabHistory });
    steps.push({ name: 'the daily series of every metric', apply: dropMetricSeries });
    steps.push({ name: 'half of the lab series', apply: trimLabSeries });
    steps.push({ name: 'the medication log', apply: dropMedications });
  }

  for (const step of steps) {
    // `trimLabSeries` may be applied repeatedly until it fits or cannot go further.
    for (let guard = 0; guard < 6; guard++) {
      const next = step.apply(current);
      if (!next) break;
      current = next;
      if (!dropped.includes(step.name)) dropped.push(step.name);
      chars = sizeOf(current, system);
      if (chars <= maxChars) break;
    }
    if (chars <= maxChars) break;
  }

  if (dropped.length > 0) {
    current = {
      ...current,
      note: `${current.note} NOT SENT, to fit the size limit: ${dropped.join('; ')}. Anything listed here exists in the data but was not given to you — do not say it is not recorded.`,
    };
    chars = sizeOf(current, system);
  }
  return { bundle: current, chars, dropped };
}
