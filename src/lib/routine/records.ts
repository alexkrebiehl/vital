// ── Sessions → performance records ──────────────────────
//
// The engine never reads a workout source directly. For each stage it collects
// `PerformanceRecord`s: one per session in which the stage's exercise was done,
// with warm-up sets removed and the totals every progression model needs worked
// out once.
//
// A stage recognises its sessions by, in order of reliability:
//   1. the source's exercise-template id (a Hevy template id);
//   2. the exercise name or an alias, compared loosely ("Push Ups" = "push-up");
//   3. an Apple Health workout type ("Running"), for plans with no source.

import type { WorkoutRecord } from '../metrics/types';
import type { LoadMeaning, TrainingSession, TrainingSet } from '../workout-sources/types';
import type { Stage } from './types';

export interface WorkingSet {
  reps?: number;
  weightKg?: number;
  durationS?: number;
  distanceM?: number;
  rpe?: number;
}

export interface PerformanceRecord {
  sessionId: string;
  /** Local calendar day (YYYY-MM-DD). */
  date: string;
  startTime: string;
  /** The exercise name as recorded, or the Apple Health workout type. */
  exerciseName: string;
  origin: 'workout-source' | 'apple-health';
  loadMeaning: LoadMeaning;
  sets: WorkingSet[];
  totals: {
    reps: number;
    /** Sum of weight × reps for added load. */
    tonnageKg: number;
    distanceM: number;
    durationS: number;
    topWeightKg: number | null;
    topRpe: number | null;
    /** Best estimated one-rep max across sets (Epley), for added load. */
    e1rmKg: number | null;
  };
  notes?: string;
}

/** Loose name key: case, punctuation and a trailing plural "s" do not matter. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/** Epley estimate; only meaningful for sets of 1–12 reps. */
export function epley(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps >= 1) || reps > 12) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

function toWorkingSet(set: TrainingSet): WorkingSet {
  const out: WorkingSet = {};
  if (set.reps !== undefined) out.reps = set.reps;
  if (set.weightKg !== undefined) out.weightKg = set.weightKg;
  if (set.durationS !== undefined) out.durationS = set.durationS;
  if (set.distanceM !== undefined) out.distanceM = set.distanceM;
  if (set.rpe !== undefined) out.rpe = set.rpe;
  return out;
}

function totalsOf(sets: WorkingSet[], loadMeaning: LoadMeaning): PerformanceRecord['totals'] {
  let reps = 0, tonnage = 0, distance = 0, duration = 0;
  let topWeight: number | null = null;
  let topRpe: number | null = null;
  let e1rm: number | null = null;
  for (const s of sets) {
    reps += s.reps ?? 0;
    distance += s.distanceM ?? 0;
    duration += s.durationS ?? 0;
    if (s.weightKg !== undefined) {
      // For assistance, the "top" set is the one with the LEAST help.
      if (topWeight === null) topWeight = s.weightKg;
      else topWeight = loadMeaning === 'assistance' ? Math.min(topWeight, s.weightKg) : Math.max(topWeight, s.weightKg);
      if (loadMeaning === 'added') {
        tonnage += s.weightKg * (s.reps ?? 0);
        const est = epley(s.weightKg, s.reps ?? 0);
        if (est !== null && (e1rm === null || est > e1rm)) e1rm = est;
      }
    }
    if (s.rpe !== undefined) topRpe = topRpe === null ? s.rpe : Math.max(topRpe, s.rpe);
  }
  return { reps, tonnageKg: tonnage, distanceM: distance, durationS: duration, topWeightKg: topWeight, topRpe, e1rmKg: e1rm };
}

export interface MatchContext {
  /** Day key for an instant, in the reader's timezone. */
  dayOf: (iso: string) => string;
}

/**
 * The same name without a "(Bodyweight)" qualifier. Apps such as Hevy log
 * "Split Squat (Bodyweight)" where a plan says "Split squat"; bodyweight is the
 * default, so the qualifier adds nothing. Other qualifiers ("(Dumbbell)",
 * "(Band)", "(Assisted)") name a different exercise and are kept.
 */
function withoutBodyweight(name: string): string {
  return name.replace(/\s*\(\s*body\s*-?\s*weight\s*\)\s*/gi, ' ').trim();
}

export function stageMatchesExercise(stage: Stage, templateId: string | null, name: string): boolean {
  if (templateId && stage.match.templateIds?.includes(templateId)) return true;
  const keys = new Set([nameKey(name), nameKey(withoutBodyweight(name))]);
  return stage.match.names.some(n => keys.has(nameKey(n)) || keys.has(nameKey(withoutBodyweight(n))));
}

/** Every session in which `stage` was trained, oldest first. */
export function recordsForStage(
  stage: Stage,
  sessions: TrainingSession[],
  workouts: WorkoutRecord[],
  ctx: MatchContext
): PerformanceRecord[] {
  const out: PerformanceRecord[] = [];
  for (const session of sessions) {
    // A stage may appear twice in one session (a superset split); combine them.
    const matching = session.exercises.filter(e => stageMatchesExercise(stage, e.sourceTemplateId, e.name));
    if (matching.length === 0) continue;
    const loadMeaning = matching[0].loadMeaning;
    const sets = matching.flatMap(e => e.sets.filter(s => s.kind !== 'warmup').map(toWorkingSet));
    if (sets.length === 0) continue;
    const notes = matching.map(e => e.notes).filter(Boolean).join(' ') || undefined;
    out.push({
      sessionId: session.id,
      date: ctx.dayOf(session.startTime),
      startTime: session.startTime,
      exerciseName: matching[0].name,
      origin: 'workout-source',
      loadMeaning,
      sets,
      totals: totalsOf(sets, loadMeaning),
      ...(notes ? { notes } : {}),
    });
  }

  const types = (stage.match.workoutTypes ?? []).map(t => t.toLowerCase());
  if (types.length) {
    for (const w of workouts) {
      if (!types.includes(w.workout_type.toLowerCase())) continue;
      const set: WorkingSet = { durationS: Math.round(w.duration_minutes * 60) };
      if (w.distance_km !== undefined) set.distanceM = Math.round(w.distance_km * 1000);
      out.push({
        sessionId: `hae:${w.id}`,
        date: ctx.dayOf(w.start_time),
        startTime: w.start_time,
        exerciseName: w.workout_type,
        origin: 'apple-health',
        loadMeaning: 'none',
        sets: [set],
        totals: totalsOf([set], 'none'),
      });
    }
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
