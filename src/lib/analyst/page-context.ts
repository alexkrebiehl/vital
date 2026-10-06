// ── Page context resolution (SERVER ONLY) ───────────────
//
// Turns a page descriptor (page-context-types.ts) into the page's current state
// for the model: the same summaries get_routine_progress returns, focused on the
// path or workout the reader has open. It is read with the routine service the
// pages use, so the model and the page cannot disagree about what is shown.
//
// Anything that no longer resolves (no active plan, a path that was removed)
// gives null: the question is still answered, just without page context.

import type { UnitSystem } from '../prefs';
import { loadRoutineContext, routineFor, workoutDetailFrom, type RoutineDeps } from '../routine/service';
import { MAX_TOOL_RESULT_CHARS, overviewSummary } from './tools';
import type { PageContextRef } from './page-context-types';
import { readGoalSummary } from '../body-goal/server';
import { installDataset } from '../adapters/runtime';
import type { BodyGoalSummary } from '../body-goal/summary';

export interface ResolvedPageContext {
  /** What the reader is looking at, in words ("the Pull-up path page"). */
  label: string;
  /** What the JSON is, when it is not a routine summary. */
  about?: string;
  /** The page's state as JSON, bounded like a tool result. */
  json: string;
}

function bounded(content: unknown): string {
  const json = JSON.stringify(content);
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]` : json;
}

export async function resolvePageContext(
  ref: PageContextRef,
  system: UnitSystem,
  deps: RoutineDeps = {},
  goalSummary: (system: UnitSystem) => Promise<BodyGoalSummary | null> = async s => {
    await installDataset({ env: deps.env ?? process.env, fetchImpl: deps.fetchImpl });
    return readGoalSummary(s, deps.env);
  }
): Promise<ResolvedPageContext | null> {
  if (ref.kind === 'body-goal') {
    const summary = await goalSummary(system);
    return {
      label: summary ? 'the Body page, which reads their data against the body goal they set' : 'the Body page; no body goal is set',
      about: 'It is the body goal and what the data says about it — the same numbers the page shows',
      json: bounded({ bodyGoal: summary }),
    };
  }
  const rc = await loadRoutineContext(deps);
  if (!rc.stored) return null;
  const routine = routineFor(rc, rc.stored, system);

  switch (ref.kind) {
    case 'routine':
      return { label: `the overview of the training plan "${routine.title}"`, json: bounded({ routine: overviewSummary(routine) }) };
    case 'routine-path': {
      const path = routine.paths.find(p => p.pathId === ref.pathId);
      if (!path) return null;
      return {
        label: `the page for the ${path.pathName} path (pathId "${path.pathId}") of the training plan "${routine.title}"`,
        json: bounded({ openPathId: path.pathId, routine: overviewSummary(routine, path.pathId) }),
      };
    }
    case 'routine-workout': {
      const detail = workoutDetailFrom(routine, ref.templateId);
      if (!detail) return null;
      return {
        label: `the page for the workout "${detail.workout.name}" (templateId "${detail.workout.id}") of the training plan "${routine.title}"`,
        json: bounded({ workout: detail.workout, routine: overviewSummary(routine) }),
      };
    }
    case 'routine-untracked': {
      const exercise = routine.untracked.find(u => u.name === ref.name);
      if (!exercise) return null;
      return {
        label: `the exercise "${exercise.name}", which the reader logs but no path in the training plan "${routine.title}" tracks`,
        json: bounded({ untrackedExercise: exercise, routine: overviewSummary(routine) }),
      };
    }
  }
}
