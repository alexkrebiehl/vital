// ── The selection is labelled (design §5.3, §9.2) ───────────
//
// The fixed context a question starts with is a STARTING SELECTION, never the record.
// `RetrievalBundle.note` stays what the user reads and what is stored; the model reads
// the text built here instead, so it is never told that "the rest of the dataset was
// not sent" in a way it could mistake for "the rest does not exist".

import type { PrivacyPolicy } from './capabilities/types';
import type { RetrievalBundle } from './types';

/** What the selection holds, one entry per block, each with its window. */
export function selectionIncludes(bundle: RetrievalBundle): string[] {
  const out: string[] = [];
  const groups = new Map<string, string[]>();
  for (const s of bundle.summaries) {
    const key = `${s.lengthLabel}, ${s.window.startKey}..${s.window.endKey}`;
    groups.set(key, [...(groups.get(key) ?? []), s.metricName]);
  }
  for (const [window, names] of groups) out.push(`metric summaries (${[...new Set(names)].join(', ')}) for ${window}`);
  if (bundle.pairs.length > 0) {
    out.push(`paired comparisons (${bundle.pairs.map(p => `${p.xMetricId} with ${p.yMetricId}, ${p.window.startKey}..${p.window.endKey}`).join('; ')})`);
  }
  if (bundle.workouts) out.push(`the workout roll-up for ${bundle.workouts.window.startKey}..${bundle.workouts.window.endKey}`);
  const lab = bundle.lab;
  if (lab?.available) {
    out.push(
      lab.selection === 'analyte' && lab.requestedName
        ? `lab results for ${lab.requestedName} (${lab.shownSeries} of ${lab.totalSeries} stored series)`
        : `a lab results overview (${lab.shownSeries} of ${lab.totalSeries} stored series)`
    );
  }
  const med = bundle.medications;
  if (med?.available) out.push(`medication records for ${med.windowFrom ?? 'the lookback'}..${med.windowTo ?? med.referenceDay ?? 'today'}`);
  return out;
}

const HEAD = (includes: string[]) =>
  `This is a STARTING SELECTION, not the record. It holds: ${includes.length ? includes.join('; ') : 'nothing'}. Everything else the app holds is listed in the coverage index above`;

/** The model-facing label of the selection, with tools (§5.3) or without them. */
export function selectionNote(includes: string[], tools: boolean): string {
  if (tools) {
    return `${HEAD(includes)} and was not included here. If the question needs anything that is not in this selection, fetch it with the tools. Never say that something is not recorded, missing or absent because it is not in this selection; say that only after a tool returned no_data_in_window for it.`;
  }
  return `${HEAD(includes)}. You cannot fetch more in this answer. For anything the question needs that is not here, say that it was not included in what you were given and how much of it the app holds (from the index); never say it is not recorded.`;
}

/**
 * The selection the privacy setting lets through. The fixed context uses the same
 * policy the tools do, so a setting cannot be bypassed by what is pre-attached.
 * Under a policy that withholds nothing the bundle is returned as it is.
 */
export function applyPolicy(bundle: RetrievalBundle, policy: PrivacyPolicy): RetrievalBundle {
  const kept: RetrievalBundle = {
    ...bundle,
    summaries: policy.allows('metric-summaries') ? bundle.summaries : [],
    pairs: policy.allows('metric-summaries') ? bundle.pairs : [],
    workouts: policy.allows('workouts') ? bundle.workouts : null,
    lab: policy.allows('lab-results') ? bundle.lab : null,
    medications: policy.allows('medication-records') ? bundle.medications : null,
  };
  const changed =
    kept.summaries !== bundle.summaries || kept.pairs !== bundle.pairs || kept.workouts !== bundle.workouts || kept.lab !== bundle.lab || kept.medications !== bundle.medications;
  if (!changed) return bundle;
  const recordsRead =
    kept.summaries.reduce((n, s) => n + s.points.length, 0) +
    kept.pairs.reduce((n, p) => n + p.pairedCount, 0) +
    (kept.workouts?.sessions ?? 0) +
    (kept.lab?.available ? kept.lab.totalObservations : 0) +
    (kept.medications?.available ? kept.medications.totalRecords : 0);
  const includes = selectionIncludes(kept);
  return { ...kept, recordsRead, note: `The AI privacy setting withheld some categories from this selection. Selected: ${includes.join('; ') || 'nothing'}; ${recordsRead} records read.` };
}
