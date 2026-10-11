// ── Workout rows and the strength join (SERVER ONLY) ────
//
// A session as the model reads it, in the registry's own formatters: the same
// ones the All Workouts page prints its totals with (formatDurationHm for time,
// formatMetricWithUnit for distance), plus the active-energy and heart-rate
// formatters for the two fields the page prints bare. A field the session did not
// record is left out: never a zero, never "0 km".

import type { UnitSystem } from '../../../prefs';
import { formatDurationHm, formatMetricWithUnit } from '../../../metrics/format';
import type { WorkoutView } from '../../../analytics/workouts';
import { matchSession } from '../../../workout-sources/match';
import type { TrainingSession, TrainingSet } from '../../../workout-sources/types';
import { scrubForModel } from '../../scrub';
import type { CapabilityContext } from '../types';

export type Row = Record<string, unknown>;

export function rowOf(v: WorkoutView, system: UnitSystem): Row {
  const display: Record<string, string> = { duration: formatDurationHm(v.duration_minutes) };
  const row: Row = { id: v.id, day: v.key, start: v.startClock, end: v.endClock, type: v.workout_type, duration: v.duration_minutes };
  if (v.hasDistance) {
    row.distance = v.distance_km;
    display.distance = formatMetricWithUnit('distance_walking_running', v.distance_km as number, system);
  }
  if (v.calories_burned !== null) {
    row.calories = v.calories_burned;
    display.calories = formatMetricWithUnit('active_energy', v.calories_burned, system);
  }
  if (typeof v.avg_heart_rate === 'number') {
    row.avgHeartRate = v.avg_heart_rate;
    display.avgHeartRate = formatMetricWithUnit('heart_rate', v.avg_heart_rate, system);
  }
  if (typeof v.max_heart_rate === 'number') {
    row.maxHeartRate = v.max_heart_rate;
    display.maxHeartRate = formatMetricWithUnit('heart_rate', v.max_heart_rate, system);
  }
  return { ...row, display };
}

/** One working set as text, the way get_training_sessions prints it. */
export function setText(x: TrainingSet): string {
  return [
    x.reps !== undefined ? `${x.reps} reps` : null,
    x.weightKg ? `${x.weightKg} kg` : null,
    x.durationS !== undefined ? `${x.durationS} s` : null,
    x.distanceM !== undefined ? `${x.distanceM} m` : null,
    x.rpe !== undefined ? `RPE ${x.rpe}` : null,
    x.kind !== 'normal' ? x.kind : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function strengthOf(s: TrainingSession): Row {
  return {
    title: s.title,
    exercises: s.exercises.map(e => ({ name: e.name, sets: e.sets.filter(x => x.kind !== 'warmup').map(setText) })),
  };
}

export interface StrengthJoin {
  /** The matching strength session of a workout, or undefined (no match, or nothing could be read). */
  forWorkout(v: WorkoutView): TrainingSession | undefined;
  /** A scrubbed line saying the read failed; empty when it did not. */
  notes: string[];
}

/**
 * The strength sessions of the connected workout sources, read once per question
 * (memoised on DataAccess). A read that fails leaves the strength detail out and says
 * so; it never fails the call.
 */
export async function loadStrength(ctx: CapabilityContext): Promise<StrengthJoin> {
  try {
    const data = await ctx.access.trainingData({ env: ctx.routine.env, fetchImpl: ctx.routine.fetchImpl });
    return { forWorkout: v => matchSession(v, data.sessions) ?? undefined, notes: [] };
  } catch (error) {
    const why = scrubForModel(error instanceof Error ? error.message : 'the read failed');
    return { forWorkout: () => undefined, notes: [`Strength detail could not be read (${why}); the sessions below carry no exercises. This says nothing about whether any were logged.`] };
  }
}
