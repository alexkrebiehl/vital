// ── Routine service (SERVER ONLY) ───────────────────────
//
// The one place that gathers everything the routine needs — the active plan,
// the training sessions from the workout sources, and the Apple Health dataset
// (workouts for plans with no source, recovery series, "today") — and hands it
// to the pure engine in progress.ts. The API routes and the analyst's tools
// both call it, so they cannot disagree about what the reader's routine is.

import { REFERENCE_KEY, REFERENCE_TZ, seriesFor, workoutList } from '../adapters/dataset';
import { installDataset } from '../adapters/runtime';
import { dayKey } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import { loadTrainingData, type TrainingData } from '../workout-sources/store';
import { buildRoutine, type PathProgress, type RoutineOverview } from './progress';
import { planRepository, revertPlan, PlanConflictError, PlanNotFoundError, type PlanRepository } from './store';
import type { PlanChange, StoredPlan } from './types';
import type { WorkoutView } from './workout-view';

export interface RoutineContext {
  stored: StoredPlan | null;
  training: TrainingData;
  today: string;
  dayOf: (iso: string) => string;
}

export interface RoutineDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  repo?: PlanRepository;
}

export async function loadRoutineContext(deps: RoutineDeps = {}): Promise<RoutineContext> {
  const env = deps.env ?? process.env;
  await installDataset({ env, fetchImpl: deps.fetchImpl });
  const repo = deps.repo ?? planRepository(env);
  const [stored, training] = await Promise.all([repo.active(), loadTrainingData({ env, fetchImpl: deps.fetchImpl })]);
  const tz = REFERENCE_TZ;
  return { stored, training, today: REFERENCE_KEY, dayOf: (iso: string) => dayKey(iso, tz) };
}

/**
 * Exercise-level sessions can be read: demo data is served, or a workout source
 * is configured (one that is failing still reports its error, and keeps serving
 * what it held).
 */
export function hasExerciseData(training: TrainingData): boolean {
  return training.origin === 'demo' || training.statuses.some(s => s.configured);
}

export function routineFor(ctx: RoutineContext, stored: StoredPlan, system: UnitSystem): RoutineOverview {
  return buildRoutine({
    stored,
    sessions: ctx.training.sessions,
    workouts: workoutList(),
    series: seriesFor,
    today: ctx.today,
    dayOf: ctx.dayOf,
    system,
    exerciseData: hasExerciseData(ctx.training),
  });
}

export interface RoutineResponse {
  state: 'ok' | 'no-plan';
  routine: RoutineOverview | null;
  sources: TrainingData['statuses'];
  origin: TrainingData['origin'];
  hasSessions: boolean;
  today: string;
}

export async function loadRoutine(system: UnitSystem, deps: RoutineDeps = {}): Promise<RoutineResponse> {
  const ctx = await loadRoutineContext(deps);
  return {
    state: ctx.stored ? 'ok' : 'no-plan',
    routine: ctx.stored ? routineFor(ctx, ctx.stored, system) : null,
    sources: ctx.training.statuses,
    origin: ctx.training.origin,
    hasSessions: ctx.training.sessions.length > 0,
    today: ctx.today,
  };
}

export interface PathDetail {
  routine: RoutineOverview;
  path: PathProgress;
}

export function pathDetailFrom(routine: RoutineOverview, pathId: string): PathDetail | null {
  const path = routine.paths.find(p => p.pathId === pathId);
  return path ? { routine, path } : null;
}

export interface WorkoutDetail {
  routine: RoutineOverview;
  workout: WorkoutView;
}

export function workoutDetailFrom(routine: RoutineOverview, templateId: string): WorkoutDetail | null {
  const workout = routine.workouts.find(w => w.id === templateId);
  return workout ? { routine, workout } : null;
}

// ── Undo ────────────────────────────────────────────────

/**
 * Reverse a change the analyst (or the reader) made. Refused when the plan has
 * moved on since — undoing an older change would silently discard a newer one.
 */
export async function undoPlanChange(change: PlanChange, deps: RoutineDeps = {}): Promise<StoredPlan | null> {
  const repo = deps.repo ?? planRepository(deps.env ?? process.env);
  const current = await repo.get(change.planId);
  if (!current) throw new PlanNotFoundError(`There is no plan "${change.planId}".`);
  if (current.revision !== change.toRevision) {
    throw new PlanConflictError(
      `The plan has changed since this edit (it is at revision ${current.revision}, the edit made ${change.toRevision}), so it cannot be undone here.`
    );
  }
  const meta = { source: 'user' as const, summary: `Undid: ${change.summary}` };
  switch (change.kind) {
    case 'create': {
      await repo.setStatus(change.planId, 'archived');
      if (change.previousActivePlanId) await repo.setStatus(change.previousActivePlanId, 'active');
      return repo.active();
    }
    case 'archive':
      return repo.setStatus(change.planId, 'active');
    case 'update':
      if (change.fromRevision === null) throw new PlanNotFoundError('This change has no earlier revision to return to.');
      return revertPlan(repo, change.planId, change.fromRevision, meta);
  }
}
