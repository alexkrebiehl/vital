// ── On-demand data access (SERVER ONLY) ─────────────────
//
// In on-demand mode the model is not handed the health data. It is handed an index
// of what exists and fetches what a question needs with read tools (tools/data.ts).
// This module is what those tools share:
//
//   * the readers, injectable so a test never touches Postgres or the HAE API, and
//     read at most once per question where that is safe;
//   * a record of everything fetched, so that
//       - an evidence card may cite a metric or lab series the model fetched (the
//         validator checks citations against the bundle), and
//       - the number audit sees the same figures the model saw.
//     `mergeFetched` folds that record back into the bundle after the loop. A
//     figure the model quotes from a tool result is therefore audited exactly like
//     one from the fixed context: nothing fetched is exempt, nothing unfetched is
//     citable.
//
// Everything here is read-only and nothing is persisted: health data is read at
// request time and held only for the life of the question.

import type { UnitSystem } from '../prefs';
import { loadLabSource } from './labContext';
import type { LabSourceInput } from './labSnapshot';
import { loadTrainingData, type TrainingData } from '../workout-sources/store';
import type { SourceRequestDeps } from '../workout-sources/types';
import type { AppReaders } from './capabilities/reads/app-readers';
import type { PrivacyPolicy } from './capabilities/types';
import { loadMedicationSnapshot } from './medicationsContext';
import { loadMedicationLog, type DayRange, type MedicationLog, type MedicationLogReader } from './medicationLog';
import type {
  LabContextSnapshot,
  LabSnapshotSeries,
  MedicationContextSnapshot,
  RetrievalBundle,
  RetrievedPair,
  RetrievedSummary,
  RetrievedWorkouts,
} from './types';

export interface Fetched {
  summaries: RetrievedSummary[];
  pairs: RetrievedPair[];
  workouts: RetrievedWorkouts | null;
  labSeries: Map<string, LabSnapshotSeries>;
  medications: MedicationContextSnapshot | null;
  /** Metric ids that were fetched without a summary (a period comparison). */
  citable: Set<string>;
  recordsRead: number;
  /** One line per fetch, in order: what the answer's reader is told was looked up. */
  log: string[];
}

export interface DataAccess {
  system: UnitSystem;
  refKey: string;
  /** The stored lab series, read once per question. */
  labSource(): Promise<LabSourceInput>;
  medications(days: number): Promise<MedicationContextSnapshot>;
  /** The medication dose records of a window; read from the source each call (its own cache applies). */
  medicationLog(range: DayRange): Promise<MedicationLog>;
  /** The strength sessions of the connected workout sources, read once per question. */
  trainingData(deps: SourceRequestDeps): Promise<TrainingData>;
  /** Test seam: replaces the readers behind get_app_data. Production leaves it unset. */
  app?: Partial<AppReaders>;
  /** The AI privacy setting that decides what the tools and the fixed selection may send; unset means everything (design §9.2). */
  policy?: PrivacyPolicy;
  fetched: Fetched;
}

export interface DataAccessOptions {
  system: UnitSystem;
  refKey: string;
  env?: NodeJS.ProcessEnv;
  labSource?: () => Promise<LabSourceInput>;
  medications?: (days: number) => Promise<MedicationContextSnapshot>;
  medicationLog?: MedicationLogReader;
  training?: (deps: SourceRequestDeps) => Promise<TrainingData>;
  app?: Partial<AppReaders>;
  policy?: PrivacyPolicy;
}

export function createDataAccess(options: DataAccessOptions): DataAccess {
  let lab: Promise<LabSourceInput> | null = null;
  let training: Promise<TrainingData> | null = null;
  const fetched: Fetched = {
    summaries: [],
    pairs: [],
    workouts: null,
    labSeries: new Map(),
    medications: null,
    citable: new Set(),
    recordsRead: 0,
    log: [],
  };
  return {
    system: options.system,
    refKey: options.refKey,
    labSource: () => (lab ??= (options.labSource ?? (() => loadLabSource({ env: options.env })))()),
    medications: days =>
      (options.medications ?? (d => loadMedicationSnapshot('', { ...(options.env ? { env: options.env } : {}), lookbackDays: d })))(days),
    medicationLog: range => (options.medicationLog ?? (r => loadMedicationLog(r, { env: options.env })))(range),
    trainingData: deps => (training ??= (options.training ?? loadTrainingData)(deps)),
    ...(options.app ? { app: options.app } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
    fetched,
  };
}

/** True when the model fetched nothing. */
export function nothingFetched(f: Fetched): boolean {
  return (
    f.summaries.length === 0 && f.pairs.length === 0 && !f.workouts && f.labSeries.size === 0 && !f.medications && f.citable.size === 0
  );
}

/**
 * The bundle the answer is validated against: the context the question started with
 * plus everything the model fetched. A summary fetched twice for the same window is
 * carried once.
 */
export function mergeFetched(bundle: RetrievalBundle, access: DataAccess | undefined, lab?: LabSourceInput | null): RetrievalBundle {
  if (!access || nothingFetched(access.fetched)) return bundle;
  const f = access.fetched;

  const summaries = [...bundle.summaries];
  for (const s of f.summaries) {
    const dup = summaries.findIndex(
      x => x.metricId === s.metricId && x.window.startKey === s.window.startKey && x.window.endKey === s.window.endKey
    );
    if (dup >= 0) summaries[dup] = s;
    else summaries.push(s);
  }

  let labBlock: LabContextSnapshot | null | undefined = bundle.lab;
  if (f.labSeries.size > 0) {
    const carried = new Map<string, LabSnapshotSeries>();
    for (const s of labBlock?.available ? labBlock.series : []) carried.set(s.seriesKey, s);
    for (const [key, s] of f.labSeries) carried.set(key, s);
    labBlock = {
      available: true,
      reason: null,
      documents: lab?.documents ?? labBlock?.documents ?? 0,
      totalObservations: lab?.totalObservations ?? labBlock?.totalObservations ?? 0,
      totalSeries: lab?.series.length ?? labBlock?.totalSeries ?? carried.size,
      collisions: lab?.collisions ?? labBlock?.collisions ?? 0,
      selection: 'analyte',
      requestedAnalyte: null,
      requestedName: null,
      found: true,
      shownSeries: carried.size,
      capped: false,
      note: `${carried.size} lab series fetched on demand`,
      notIncludedSeries: [],
      series: [...carried.values()],
    };
  }

  return {
    ...bundle,
    summaries,
    pairs: [...bundle.pairs, ...f.pairs],
    workouts: f.workouts ?? bundle.workouts,
    lab: labBlock,
    medications: f.medications ?? bundle.medications,
    citable: [...new Set([...(bundle.citable ?? []), ...f.citable])],
    recordsRead: bundle.recordsRead + f.recordsRead,
    note: `${bundle.note} Fetched on demand: ${f.log.join('; ')}.`,
  };
}
