// ── Merge the Health Auto Export dataset with the Oura contribution (pure) ──
//
// Two sources can describe the same day. They are never summed or averaged:
// for each metric and each day one source's value is kept, and the other
// source only fills days the first one has nothing for. Which source comes
// first is a configuration choice per metric group (`OURA_PREFERRED_FOR`).
//
// A missing source never existed: `mergeDatasets(hae, null)` returns `hae`
// itself, untouched, so a Vital without a ring is byte-for-byte what it was.

import type { HealthFixtures, MetricCoverage, WorkoutRecord } from '../metrics/types';
import { dayKey, dayKeyToDate, diffDays } from '../analytics/windows';
import { intervalsMatch } from '../workout-sources/match';
import type { BuiltDataset, ProvenanceRow } from './normalize';
import { OURA_PREFERENCE_GROUPS, OURA_GROUP_METRICS, type OuraPreferenceGroup } from './oura/config';
import { OURA_SOURCE_NAME, type OuraContribution } from './oura/normalize';

/** What the Health Auto Export path hands over: the dataset, its provenance and its counts. */
export type BuiltPart = BuiltDataset;

/** Token in `preferRing` that stands for the workout list, which has no metric id. */
export const WORKOUTS_KEY = 'workouts';

export interface MergeRules {
  /** Metric ids (and `WORKOUTS_KEY`) for which the ring is preferred over the watch. */
  preferRing: Set<string>;
}

/** Where a ring-only dataset is anchored; with HAE present its own frame is used. */
export interface DatasetFrame {
  /** The instant "now" is anchored to (ISO). */
  referenceDate: string;
  timezone: string;
}

/** The merge rule in plain language, quoted in the provenance panel next to the dedupe rule. */
export const MERGE_RULE =
  'When the watch and the ring both recorded a day, one source is kept for that day and the other is set aside: ' +
  'values are never added or averaged across sources. The other source fills only the days the first one lacks. ' +
  'A night keeps one sleep episode, and a workout recorded by both is one workout.';

/** Expand preferred groups (`sleep`, `workouts`, …) into the ids `mergeDatasets` reads. */
export function preferRingFromGroups(groups: readonly OuraPreferenceGroup[]): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    if (!OURA_PREFERENCE_GROUPS.includes(g)) continue;
    for (const id of OURA_GROUP_METRICS[g]) out.add(id);
    if (g === 'workouts') out.add(WORKOUTS_KEY);
  }
  return out;
}

type Row = { date: string };

function instantOf(text: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? dayKeyToDate(text).toISOString() : text;
}

function earliest(a: string, b: string): string {
  return Date.parse(instantOf(a)) <= Date.parse(instantOf(b)) ? a : b;
}

function latest(a: string, b: string): string {
  return Date.parse(instantOf(a)) >= Date.parse(instantOf(b)) ? a : b;
}

/** One source's rows win; the other's fill only the days that source lacks. */
function mergeSeries(primary: Row[], secondary: Row[]): { rows: Row[]; usedPrimary: number; usedSecondary: number; setAside: number } {
  const have = new Set(primary.map(r => r.date));
  const filler = secondary.filter(r => !have.has(r.date));
  const rows = [...primary, ...filler].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, usedPrimary: primary.length, usedSecondary: filler.length, setAside: secondary.length - filler.length };
}

function sameWorkout(a: WorkoutRecord, b: WorkoutRecord): boolean {
  const x = { start: a.start_time, end: a.end_time };
  const y = { start: b.start_time, end: b.end_time };
  return intervalsMatch(x, y) || intervalsMatch(y, x);
}

function mergeWorkouts(primary: WorkoutRecord[], secondary: WorkoutRecord[]): { workouts: WorkoutRecord[]; setAside: number } {
  const kept = [...primary];
  let setAside = 0;
  for (const w of secondary) {
    if (primary.some(p => sameWorkout(p, w))) setAside += 1;
    else kept.push(w);
  }
  kept.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id));
  return { workouts: kept, setAside };
}

function recountRow(row: ProvenanceRow, rows: Row[]): ProvenanceRow {
  return {
    ...row,
    observations: rows.length,
    firstDay: rows[0]?.date ?? null,
    lastDay: rows[rows.length - 1]?.date ?? null,
    dedupeRule: `${row.dedupeRule} ${MERGE_RULE}`,
  };
}

function frameFrom(frame: DatasetFrame, oura: OuraContribution): Pick<HealthFixtures, 'referenceDate' | 'windowStart' | 'windowEnd' | 'days' | 'timezone'> {
  const firsts = [...Object.values(oura.coverage).map(c => c.firstObservation), ...oura.workouts.map(w => w.start_time)].filter(Boolean);
  const lasts = [...Object.values(oura.coverage).map(c => c.lastObservation), ...oura.workouts.map(w => w.end_time)].filter(Boolean);
  const windowStart = firsts.length > 0 ? instantOf(firsts.reduce(earliest)) : frame.referenceDate;
  const windowEnd = lasts.length > 0 ? instantOf(lasts.reduce(latest)) : frame.referenceDate;
  return {
    referenceDate: frame.referenceDate,
    windowStart,
    windowEnd,
    days: diffDays(dayKey(windowStart, frame.timezone), dayKey(frame.referenceDate, frame.timezone)) + 1,
    timezone: frame.timezone,
  };
}

function ouraObservationCount(oura: OuraContribution): number {
  return Object.values(oura.metrics).reduce((n, rows) => n + rows.length, 0);
}

/** The ring contribution on its own, shaped like a built dataset. */
function ouraOnly(oura: OuraContribution, frame: DatasetFrame): BuiltPart {
  return {
    dataset: { ...frameFrom(frame, oura), metrics: oura.metrics, workouts: oura.workouts, coverage: oura.coverage },
    provenance: oura.provenance,
    stats: {
      recordsRead: oura.recordsRead,
      observations: ouraObservationCount(oura),
      metrics: Object.keys(oura.metrics).length,
      workouts: oura.workouts.length,
      droppedRecords: 0,
      droppedIntervals: 0,
    },
  };
}

export function mergeDatasets(hae: BuiltPart, oura: OuraContribution | null, rules: MergeRules): BuiltPart;
export function mergeDatasets(hae: null, oura: OuraContribution, rules: MergeRules, frame: DatasetFrame): BuiltPart;
export function mergeDatasets(hae: BuiltPart | null, oura: OuraContribution | null, rules: MergeRules, frame?: DatasetFrame): BuiltPart | null;
export function mergeDatasets(
  hae: BuiltPart | null,
  oura: OuraContribution | null,
  rules: MergeRules,
  frame?: DatasetFrame
): BuiltPart | null {
  if (!oura) return hae;
  if (!hae) {
    if (!frame) throw new Error('A ring-only dataset needs a frame (reference date and timezone).');
    return ouraOnly(oura, frame);
  }

  const metrics: HealthFixtures['metrics'] = { ...hae.dataset.metrics };
  const coverage: Record<string, MetricCoverage> = { ...hae.dataset.coverage };
  const touched = new Map<string, { hae: Row[]; oura: Row[] }>();
  let setAsideRows = 0;
  let setAsideIntervals = 0;
  let haeRowsLost = 0;
  let ouraRowsKept = 0;

  for (const [id, ouraRows] of Object.entries(oura.metrics) as [string, Row[]][]) {
    const haeRows = hae.dataset.metrics[id] as Row[] | undefined;
    if (!haeRows) {
      metrics[id] = ouraRows as never;
      ouraRowsKept += ouraRows.length;
      if (oura.coverage[id]) coverage[id] = oura.coverage[id];
      continue;
    }
    const ringFirst = rules.preferRing.has(id);
    const merged = ringFirst ? mergeSeries(ouraRows, haeRows) : mergeSeries(haeRows, ouraRows);
    metrics[id] = merged.rows as never;
    setAsideRows += merged.setAside;
    setAsideIntervals += merged.setAside;
    if (ringFirst) haeRowsLost += merged.setAside;
    const haeKept = ringFirst ? merged.usedSecondary : merged.usedPrimary;
    const ouraKept = ringFirst ? merged.usedPrimary : merged.usedSecondary;
    const haeKeptRows = merged.rows.filter(r => (haeRows as Row[]).includes(r));
    const ouraKeptRows = merged.rows.filter(r => (ouraRows as Row[]).includes(r));
    ouraRowsKept += ouraKept;
    touched.set(id, { hae: haeKeptRows, oura: ouraKeptRows });

    const hc = hae.dataset.coverage[id];
    const oc = oura.coverage[id];
    const names = new Set<string>();
    if (haeKept > 0 && hc) hc.sourceNames.forEach(n => names.add(n));
    if (ouraKept > 0) names.add(OURA_SOURCE_NAME);
    const days = new Set(merged.rows.map(r => r.date));
    coverage[id] = {
      firstObservation: [hc?.firstObservation, oc?.firstObservation].filter((x): x is string => !!x).reduce(earliest, merged.rows[0].date),
      lastObservation: [hc?.lastObservation, oc?.lastObservation].filter((x): x is string => !!x).reduce(latest, merged.rows[merged.rows.length - 1].date),
      observedDays: days.size,
      expectedDays: hc?.expectedDays ?? oc?.expectedDays ?? days.size,
      samplingFrequency: (ringFirst ? oc : hc)?.samplingFrequency ?? hc?.samplingFrequency ?? '',
      sourceNames: [...names].sort(),
    };
  }

  const ringFirstWorkouts = rules.preferRing.has(WORKOUTS_KEY);
  const mergedWorkouts = ringFirstWorkouts
    ? mergeWorkouts(oura.workouts, hae.dataset.workouts)
    : mergeWorkouts(hae.dataset.workouts, oura.workouts);
  setAsideRows += mergedWorkouts.setAside;

  // Provenance: one row per (metric, source); a metric both sources recorded notes the merge.
  const provenance: ProvenanceRow[] = [
    ...hae.provenance.map(p => (touched.has(p.metricId) ? recountRow(p, touched.get(p.metricId)!.hae) : p)),
    ...oura.provenance.map(p => (touched.has(p.metricId) ? recountRow(p, touched.get(p.metricId)!.oura) : p)),
  ];

  const window = frameFrom({ referenceDate: hae.dataset.referenceDate, timezone: hae.dataset.timezone }, oura);
  const windowStart = earliest(hae.dataset.windowStart, window.windowStart);
  const windowEnd = latest(hae.dataset.windowEnd, window.windowEnd);
  const dataset: HealthFixtures = {
    ...hae.dataset,
    windowStart,
    windowEnd,
    days: diffDays(dayKey(windowStart, hae.dataset.timezone), dayKey(hae.dataset.referenceDate, hae.dataset.timezone)) + 1,
    metrics,
    workouts: mergedWorkouts.workouts,
    coverage,
  };

  return {
    dataset,
    provenance,
    stats: {
      recordsRead: hae.stats.recordsRead + oura.recordsRead,
      observations: hae.stats.observations - haeRowsLost + ouraRowsKept,
      metrics: Object.keys(metrics).length,
      workouts: mergedWorkouts.workouts.length,
      droppedRecords: hae.stats.droppedRecords + setAsideRows,
      droppedIntervals: hae.stats.droppedIntervals + setAsideIntervals,
    },
  };
}
