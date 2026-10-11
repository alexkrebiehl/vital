// ── training.workout_template (SERVER ONLY) ──────────────────────────────────
//
// One session template of the active plan as a day of training, as the workout page
// and GET /api/routine/workouts/[templateId] serve it: the domains it covers, each
// slot's stage, dose and light, and what comes next. Only the workout is kept; the
// route also returns the whole routine, the sources and their hosts.

import { loadRoutine, workoutDetailFrom } from '../../../routine/service';
import type { WorkoutView } from '../../../routine/workout-view';
import { manifestEntry } from '../manifest';
import { invalidArgs, ok } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, problemsOf, type Args, type Read } from './common';
import { clean, nothing } from './app-common';
import { countOf } from './app-format';

export const MAX_TEMPLATE_ID = 80;

function workoutRow(w: WorkoutView) {
  return clean({
    id: w.id,
    name: w.name,
    minutes: w.minutes ? `${w.minutes} min` : undefined,
    warmup: w.warmup.length ? w.warmup : undefined,
    when: w.when,
    lastDone: w.lastDone,
    done: countOf(w.timesDone, 'time'),
    domains: w.domains.map(d => ({
      area: d.areaName,
      slots: d.slots.map(s =>
        clean({
          path: s.pathName,
          stage: s.stageName,
          step: s.stepName,
          dose: s.dose,
          optional: s.optional || undefined,
          note: s.note,
          rotatesWith: s.rotatesWith.length ? s.rotatesWith : undefined,
          light: s.light,
          tracked: s.tracked,
          readiness: s.readiness?.label,
          lastSession: s.lastSession ? `${s.lastSession.date}: ${s.lastSession.work}` : undefined,
          cues: s.cues.length ? s.cues : undefined,
          onHold: s.onHold || undefined,
          next: s.nextName,
          suggestion: s.suggestion?.text,
          topOfPath: s.topOfPath || undefined,
        })
      ),
    })),
  });
}

export function readWorkoutTemplate(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('training.workout_template');
  return guarded(entry, ctx, async () => {
    const id = args.templateId;
    if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_TEMPLATE_ID) return problemsOf(entry, [`templateId must be a workout id, up to ${MAX_TEMPLATE_ID} characters.`]);
    const loaded = await loadRoutine(ctx.system, ctx.routine);
    if (!loaded.routine) return nothing(entry, 'There is no active training plan.');
    const detail = workoutDetailFrom(loaded.routine, id);
    if (!detail) return invalidArgs(entry, [`The active plan has no workout "${id}".`], { didYouMean: loaded.routine.workouts.map(w => w.id) });
    return ok(entry, workoutRow(detail.workout));
  });
}
