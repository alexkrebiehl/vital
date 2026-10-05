// ── Oura documents → Vital's internal dataset (pure) ─────
//
// Turns the raw Oura v2 documents into the same partial dataset shape the
// Health Auto Export path produces, so pages never know which source a number
// came from. No I/O, no clock, no logging: documents in, observations out.
//
// What is mapped, and what is deliberately not, is the table in
// oura-source-plan.md §0. In short:
//   - Equivalent measures reuse the existing registry ids (sleep, breathing
//     rate, SpO2, steps, active energy, VO2 max, heart rate, workouts).
//   - Measures that only look alike get their own ids (overnight RMSSD,
//     lowest overnight heart rate, temperature deviation).
//   - Vendor scores, `equivalent_walking_distance` and the breathing
//     disturbance index are not mapped at all.
//
// A null is never turned into a number: an absent value is an absent
// observation, never a zero.

import { getMetric } from '../../metrics/registry';
import type {
  MetricCoverage,
  MetricObservation,
  SleepObservation,
  WorkoutRecord,
} from '../../metrics/types';
import { dayKey, diffDays } from '../../analytics/windows';
import type { DayAggregation, NormalizeContext, ProvenanceRow } from '../normalize';
import { heartRateObservations, round, type DailyHeartRate } from '../normalize';

/** The one source name every Oura record carries. */
export const OURA_SOURCE_NAME = 'Oura Ring';

// ── Raw documents (only the fields read) ────────────────

export type OuraSleepType = 'deleted' | 'sleep' | 'long_sleep' | 'late_nap' | 'rest';

export interface OuraSleepDoc {
  id?: string;
  /** The day the sleep belongs to (the wake-up day). */
  day: string;
  type?: OuraSleepType | string | null;
  bedtime_start?: string | null;
  bedtime_end?: string | null;
  /** Seconds. */
  time_in_bed?: number | null;
  total_sleep_duration?: number | null;
  deep_sleep_duration?: number | null;
  light_sleep_duration?: number | null;
  rem_sleep_duration?: number | null;
  awake_time?: number | null;
  average_breath?: number | null;
  /** Integer ms, RMSSD. */
  average_hrv?: number | null;
  lowest_heart_rate?: number | null;
}

export interface OuraDailyActivityDoc {
  day: string;
  steps?: number | null;
  active_calories?: number | null;
}

export interface OuraDailySpo2Doc {
  day: string;
  spo2_percentage?: { average?: number | null } | null;
}

export interface OuraDailyReadinessDoc {
  day: string;
  /** °C relative to the user's baseline. */
  temperature_deviation?: number | null;
}

export interface OuraVo2MaxDoc {
  day: string;
  vo2_max?: number | null;
}

export interface OuraHeartRateRow {
  timestamp: string;
  bpm?: number | null;
  source?: string | null;
}

export interface OuraWorkoutDoc {
  id?: string;
  activity?: string | null;
  label?: string | null;
  calories?: number | null;
  /** Metres. */
  distance?: number | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
}

/** One array per Oura collection. Any of them may be absent (scope not granted, nothing recorded). */
export interface OuraRawBundle {
  sleep?: OuraSleepDoc[];
  dailyActivity?: OuraDailyActivityDoc[];
  dailySpo2?: OuraDailySpo2Doc[];
  dailyReadiness?: OuraDailyReadinessDoc[];
  vo2Max?: OuraVo2MaxDoc[];
  heartrate?: OuraHeartRateRow[];
  workouts?: OuraWorkoutDoc[];
}

/** The partial dataset this source contributes; merged with HAE's by `merge.ts`. */
export interface OuraContribution {
  metrics: Record<string, MetricObservation[] | SleepObservation[]>;
  coverage: Record<string, MetricCoverage>;
  workouts: WorkoutRecord[];
  provenance: ProvenanceRow[];
  recordsRead: number;
  sources: string[];
}

// ── Helpers ─────────────────────────────────────────────

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function isDay(x: unknown): x is string {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

/** Seconds → minutes, one decimal; null stays null. */
function minutes(seconds: unknown): number | null {
  const s = num(seconds);
  return s === null ? null : round(s / 60, 1);
}

function unitOf(metricId: string): string {
  return getMetric(metricId)?.canonicalUnit ?? '';
}

function observation(metricId: string, date: string, qty: number): MetricObservation {
  return { date, qty: round(qty, 6), units: unitOf(metricId), source: OURA_SOURCE_NAME };
}

/** `strength_training` → `Strength Training`. */
export function humanizeActivity(text: string): string {
  return text
    .trim()
    .replace(/[_\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Sleep ───────────────────────────────────────────────

function bedMinutes(doc: OuraSleepDoc): number | null {
  const fromField = minutes(doc.time_in_bed);
  if (fromField !== null) return fromField;
  if (doc.bedtime_start && doc.bedtime_end) {
    const ms = Date.parse(doc.bedtime_end) - Date.parse(doc.bedtime_start);
    if (Number.isFinite(ms) && ms > 0) return round(ms / 60000, 1);
  }
  return null;
}

/** The period that stands for the day: the long sleep, else the longest one. Never a sum. */
function chooseSleep(docs: OuraSleepDoc[]): OuraSleepDoc | null {
  const usable = docs.filter(d => d.type !== 'deleted' && isDay(d.day) && (bedMinutes(d) !== null || num(d.total_sleep_duration) !== null));
  if (usable.length === 0) return null;
  const length = (d: OuraSleepDoc) => bedMinutes(d) ?? minutes(d.total_sleep_duration) ?? 0;
  const ordered = [...usable].sort((a, b) => length(b) - length(a) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  return ordered.find(d => d.type === 'long_sleep') ?? ordered[0];
}

function sleepObservation(doc: OuraSleepDoc): SleepObservation {
  const deep = minutes(doc.deep_sleep_duration) ?? 0;
  const rem = minutes(doc.rem_sleep_duration) ?? 0;
  const core = minutes(doc.light_sleep_duration) ?? 0;
  const awake = minutes(doc.awake_time) ?? 0;
  const staged = round(deep + rem + core, 1);
  // Oura's total is authoritative when present; the stage sum is the fallback.
  const asleep = minutes(doc.total_sleep_duration) ?? staged;
  const inBed = Math.max(bedMinutes(doc) ?? 0, asleep);
  return {
    date: doc.day,
    bedtime: doc.bedtime_start ?? '',
    wakeTime: doc.bedtime_end ?? '',
    durationMinutes: round(asleep + awake, 1),
    inBedMinutes: round(inBed, 1),
    asleepMinutes: asleep,
    stages: { deep, rem, core, awake },
    source: OURA_SOURCE_NAME,
  };
}

// ── Heart rate ──────────────────────────────────────────

function dailyHeartRate(rows: OuraHeartRateRow[], tz: string): DailyHeartRate[] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const bpm = num(r.bpm);
    if (bpm === null || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) continue;
    const key = dayKey(r.timestamp, tz);
    const list = byDay.get(key);
    if (list) list.push(bpm);
    else byDay.set(key, [bpm]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      avg: round(v.reduce((a, b) => a + b, 0) / v.length, 2),
      max: Math.max(...v),
      min: Math.min(...v),
      count: v.length,
      source: OURA_SOURCE_NAME,
    }));
}

// ── Workouts ────────────────────────────────────────────

function normalizeWorkouts(docs: OuraWorkoutDoc[]): WorkoutRecord[] {
  const seen = new Set<string>();
  const out: WorkoutRecord[] = [];
  for (const d of docs) {
    const start = d.start_datetime;
    const end = d.end_datetime;
    const name = (d.label && d.label.trim()) || d.activity || '';
    if (!start || !end || !name || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) continue;
    const id = `oura:${d.id && String(d.id).trim() ? d.id : `${d.activity}:${start}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const ms = Date.parse(end) - Date.parse(start);
    const calories = num(d.calories);
    const distance = num(d.distance);
    const record: WorkoutRecord = {
      id,
      workout_type: humanizeActivity(name),
      start_time: start,
      end_time: end,
      duration_minutes: round(ms > 0 ? ms / 60000 : 0, 1),
      // Unknown calories stay unknown. They are never written as zero.
      calories_burned: calories === null ? null : Math.round(calories),
      source: OURA_SOURCE_NAME,
    };
    if (distance !== null) record.distance_km = round(distance / 1000, 2);
    out.push(record);
  }
  return out.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id));
}

// ── Assembly ────────────────────────────────────────────

interface Spec {
  metricId: string;
  /** `collection.field`, shown in the provenance panel as the upstream name. */
  upstream: string;
  aggregation: DayAggregation | 'sleep';
  frequency: string;
  rule: string;
  conversions: string[];
}

const ONE_PER_DAY = 'The ring records one value per day; there is nothing to de-duplicate within the source.';
const SLEEP_PICK =
  'One period per day: the long sleep, else the longest period that was not deleted. Periods are never added together.';

const SPECS = {
  sleep: { metricId: 'sleep_analysis', upstream: 'sleep', aggregation: 'sleep', frequency: 'nightly', rule: SLEEP_PICK, conversions: ['s → min'] },
  breath: { metricId: 'respiratory_rate', upstream: 'sleep.average_breath', aggregation: 'latest', frequency: 'nightly', rule: SLEEP_PICK, conversions: [] },
  hrv: { metricId: 'hrv_rmssd_sleep', upstream: 'sleep.average_hrv', aggregation: 'latest', frequency: 'nightly', rule: SLEEP_PICK, conversions: [] },
  lowHr: { metricId: 'lowest_heart_rate_sleep', upstream: 'sleep.lowest_heart_rate', aggregation: 'latest', frequency: 'nightly', rule: SLEEP_PICK, conversions: [] },
  steps: { metricId: 'step_count', upstream: 'daily_activity.steps', aggregation: 'sum', frequency: 'daily', rule: ONE_PER_DAY, conversions: [] },
  active: { metricId: 'active_energy', upstream: 'daily_activity.active_calories', aggregation: 'sum', frequency: 'daily', rule: ONE_PER_DAY, conversions: [] },
  spo2: { metricId: 'blood_oxygen_saturation', upstream: 'daily_spo2.spo2_percentage.average', aggregation: 'mean', frequency: 'nightly', rule: ONE_PER_DAY, conversions: [] },
  temp: { metricId: 'temperature_deviation', upstream: 'daily_readiness.temperature_deviation', aggregation: 'latest', frequency: 'nightly', rule: ONE_PER_DAY, conversions: [] },
  vo2: { metricId: 'vo2max', upstream: 'vO2_max.vo2_max', aggregation: 'latest', frequency: 'occasional estimate', rule: ONE_PER_DAY, conversions: [] },
  heart: { metricId: 'heart_rate', upstream: 'heartrate.bpm', aggregation: 'mean', frequency: 'continuous', rule: 'Every sample of a local day is averaged, whatever its source tag.', conversions: [] },
} satisfies Record<string, Spec>;

/** Every metric id this source can contribute. */
export const OURA_METRIC_IDS: ReadonlySet<string> = new Set(Object.values(SPECS).map(s => s.metricId));

export function normalizeOura(raw: OuraRawBundle, ctx: NormalizeContext): OuraContribution {
  const metrics: OuraContribution['metrics'] = {};
  const coverage: OuraContribution['coverage'] = {};
  const provenance: ProvenanceRow[] = [];
  const expectedDays = diffDays(ctx.windowStartKey, ctx.referenceKey) + 1;

  const add = (spec: Spec, rows: MetricObservation[] | SleepObservation[], recordsRead: number, instants?: [string, string]) => {
    if (rows.length === 0) return;
    const days = rows.map(r => r.date);
    metrics[spec.metricId] = rows;
    coverage[spec.metricId] = {
      firstObservation: instants?.[0] ?? days[0],
      lastObservation: instants?.[1] ?? days[days.length - 1],
      observedDays: new Set(days).size,
      expectedDays,
      samplingFrequency: spec.frequency,
      sourceNames: [OURA_SOURCE_NAME],
    };
    provenance.push({
      metricId: spec.metricId,
      haeMetric: spec.upstream,
      aggregation: spec.aggregation,
      canonicalUnit: unitOf(spec.metricId),
      sources: [OURA_SOURCE_NAME],
      observations: rows.length,
      recordsRead,
      recordsKept: rows.length,
      firstDay: days[0] ?? null,
      lastDay: days[days.length - 1] ?? null,
      unitConversions: spec.conversions,
      dedupeRule: spec.rule,
    });
  };

  const sorted = <T extends { date: string }>(rows: T[]) => rows.sort((a, b) => a.date.localeCompare(b.date));

  // Sleep and the three measures taken from the same chosen period.
  const sleepDocs = raw.sleep ?? [];
  const byDay = new Map<string, OuraSleepDoc[]>();
  for (const d of sleepDocs) {
    if (!isDay(d.day)) continue;
    const list = byDay.get(d.day);
    if (list) list.push(d);
    else byDay.set(d.day, [d]);
  }
  const nights: SleepObservation[] = [];
  const breath: MetricObservation[] = [];
  const hrv: MetricObservation[] = [];
  const lowHr: MetricObservation[] = [];
  for (const [day, docs] of byDay) {
    const chosen = chooseSleep(docs);
    if (!chosen) continue;
    nights.push(sleepObservation(chosen));
    const b = num(chosen.average_breath);
    if (b !== null) breath.push(observation('respiratory_rate', day, b));
    const h = num(chosen.average_hrv);
    if (h !== null) hrv.push(observation('hrv_rmssd_sleep', day, h));
    const l = num(chosen.lowest_heart_rate);
    if (l !== null) lowHr.push(observation('lowest_heart_rate_sleep', day, l));
  }
  add(SPECS.sleep, sorted(nights), sleepDocs.length);
  add(SPECS.breath, sorted(breath), sleepDocs.length);
  add(SPECS.hrv, sorted(hrv), sleepDocs.length);
  add(SPECS.lowHr, sorted(lowHr), sleepDocs.length);

  // Daily documents. One document per day, keyed by Oura's own `day`.
  const daily = <D extends { day: string }>(
    docs: D[] | undefined,
    spec: Spec,
    pick: (d: D) => number | null,
    partialToday = false
  ) => {
    const rows: MetricObservation[] = [];
    for (const d of docs ?? []) {
      if (!isDay(d.day)) continue;
      const v = pick(d);
      if (v === null) continue;
      const o = observation(spec.metricId, d.day, v);
      // The reference day is still filling up; keep it out of comparisons.
      if (partialToday && d.day === ctx.referenceKey) o.partial = true;
      rows.push(o);
    }
    add(spec, sorted(rows), docs?.length ?? 0);
  };
  daily(raw.dailyActivity, SPECS.steps, d => num(d.steps), true);
  daily(raw.dailyActivity, SPECS.active, d => num(d.active_calories), true);
  daily(raw.dailySpo2, SPECS.spo2, d => num(d.spo2_percentage?.average));
  daily(raw.dailyReadiness, SPECS.temp, d => num(d.temperature_deviation));
  daily(raw.vo2Max, SPECS.vo2, d => num(d.vo2_max));

  // Heart rate: daily mean, with the day's range alongside, as the HAE path does.
  const hrRows = raw.heartrate ?? [];
  const dailyHr = dailyHeartRate(hrRows, ctx.tz);
  if (dailyHr.length > 0) {
    const stamps = hrRows
      .map(r => r.timestamp)
      .filter(t => typeof t === 'string' && Number.isFinite(Date.parse(t)))
      .sort();
    add(
      SPECS.heart,
      heartRateObservations(dailyHr).map(o => ({ ...o, source: OURA_SOURCE_NAME })),
      hrRows.length,
      [stamps[0], stamps[stamps.length - 1]]
    );
  }

  const workouts = normalizeWorkouts(raw.workouts ?? []);

  const recordsRead = Object.values(raw).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
  const contributed = Object.keys(metrics).length > 0 || workouts.length > 0;
  return {
    metrics,
    coverage,
    workouts,
    provenance,
    recordsRead,
    sources: contributed ? [OURA_SOURCE_NAME] : [],
  };
}
