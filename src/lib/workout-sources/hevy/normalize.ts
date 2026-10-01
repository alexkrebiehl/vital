// ── Hevy → TrainingSession ──────────────────────────────
//
// Pure mapping from Hevy's wire shapes to the shared training model. A workout
// without an id or a parseable start is dropped rather than guessed at; a set's
// missing numbers stay missing (never zero), because a zero would read as a
// real, terrible performance.

import type {
  ExerciseTemplateInfo,
  LoadMeaning,
  TrainingExercise,
  TrainingSession,
  TrainingSet,
  TrainingSetKind,
} from '../types';
import type { HevyWireExercise, HevyWireSet, HevyWireTemplate, HevyWireWorkout } from './client';

export const HEVY_SOURCE_ID = 'hevy';

const SET_KINDS: TrainingSetKind[] = ['normal', 'warmup', 'dropset', 'failure'];

/** Hevy exercise types → what a set's weight means. */
export function loadMeaningFor(hevyType: string | undefined, title = ''): LoadMeaning {
  switch (hevyType) {
    case 'bodyweight_assisted_reps':
      return 'assistance';
    case 'weight_reps':
    case 'weight_duration':
    case 'short_distance_weight':
      return 'added';
    case 'bodyweight_reps':
      // "Weighted" bodyweight work records the added load.
      return 'added';
    case 'reps_only':
    case 'duration':
    case 'distance_duration':
      return 'none';
    default:
      // No catalogue entry: fall back to the name, which Hevy keeps descriptive.
      return /\bassisted\b/i.test(title) ? 'assistance' : 'added';
  }
}

export function normalizeTemplate(t: HevyWireTemplate): ExerciseTemplateInfo | null {
  if (!t.id || !t.title) return null;
  return {
    sourceId: HEVY_SOURCE_ID,
    id: t.id,
    name: t.title,
    kind: t.type ?? 'unknown',
    loadMeaning: loadMeaningFor(t.type, t.title),
    primaryMuscle: t.primary_muscle_group || undefined,
    secondaryMuscles: t.secondary_muscle_groups?.length ? t.secondary_muscle_groups : undefined,
    equipment: t.equipment || undefined,
    custom: Boolean(t.is_custom),
  };
}

function num(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSet(set: HevyWireSet, position: number): TrainingSet {
  const kind = SET_KINDS.includes(set.type as TrainingSetKind) ? (set.type as TrainingSetKind) : 'normal';
  const out: TrainingSet = { index: num(set.index) ?? position, kind };
  const reps = num(set.reps);
  const weight = num(set.weight_kg);
  const duration = num(set.duration_seconds);
  const distance = num(set.distance_meters);
  const rpe = num(set.rpe);
  if (reps !== undefined) out.reps = reps;
  if (weight !== undefined) out.weightKg = weight;
  if (duration !== undefined) out.durationS = duration;
  if (distance !== undefined) out.distanceM = distance;
  if (rpe !== undefined) out.rpe = rpe;
  return out;
}

function normalizeExercise(
  exercise: HevyWireExercise,
  templates: Record<string, ExerciseTemplateInfo>
): TrainingExercise | null {
  const name = (exercise.title ?? '').trim();
  if (!name) return null;
  const templateId = exercise.exercise_template_id ?? null;
  const template = templateId ? templates[templateId] : undefined;
  const sets = (exercise.sets ?? []).map(normalizeSet).sort((a, b) => a.index - b.index);
  const out: TrainingExercise = {
    sourceTemplateId: templateId,
    name,
    loadMeaning: template?.loadMeaning ?? loadMeaningFor(undefined, name),
    sets,
  };
  if (template?.primaryMuscle) out.primaryMuscle = template.primaryMuscle;
  if (template?.secondaryMuscles) out.secondaryMuscles = template.secondaryMuscles;
  const notes = exercise.notes?.trim();
  if (notes) out.notes = notes;
  return out;
}

export function sessionId(hevyId: string): string {
  return `${HEVY_SOURCE_ID}:${hevyId}`;
}

export function normalizeWorkout(
  workout: HevyWireWorkout,
  templates: Record<string, ExerciseTemplateInfo> = {}
): TrainingSession | null {
  if (!workout.id) return null;
  const start = Date.parse(workout.start_time ?? '');
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(workout.end_time ?? '');
  const exercises = [...(workout.exercises ?? [])]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(e => normalizeExercise(e, templates))
    .filter((e): e is TrainingExercise => e !== null);
  const session: TrainingSession = {
    id: sessionId(workout.id),
    sourceId: HEVY_SOURCE_ID,
    title: (workout.title ?? '').trim() || 'Workout',
    startTime: new Date(start).toISOString(),
    endTime: new Date(Number.isFinite(end) ? end : start).toISOString(),
    exercises,
  };
  const notes = workout.description?.trim();
  if (notes) session.notes = notes;
  return session;
}
