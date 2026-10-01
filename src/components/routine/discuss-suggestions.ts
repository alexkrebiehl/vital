// ── Suggested questions for "Discuss with analyst" ──────
//
// Built from what each routine page shows, so the dialog opens with questions
// about this path, this workout or this plan rather than generic ones. Pure and
// instant: no model is asked. Every set includes a question the demo analyst
// can route too ("routine", "plan", "progress" or "progression" — demo-plan.ts),
// so the dialog is useful without a configured provider.
//
// Nothing here assumes a discipline: paths, stages and workouts are named from
// the plan itself.

import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { WorkoutView } from '@/lib/routine/workout-view';

export const CREATE_PROMPT = 'Create a training plan for me. Ask me about my goal, schedule and equipment first.';

const LIGHT_WORD: Record<PathProgress['light'], string | null> = {
  green: 'green',
  'yellow-green': 'yellow-green',
  yellow: 'yellow',
  red: 'red',
  none: null,
};

export function routineSuggestions(routine: RoutineOverview): string[] {
  const out = ['How is my routine going?'];
  if (routine.deload.status === 'due' || routine.deload.status === 'overdue') out.push('Should I start a deload this week?');
  if (routine.currentPhase) out.push(`What do I need to finish phase ${routine.currentPhase.name}?`);
  if (routine.recovery.status === 'watch' || routine.recovery.status === 'warn') out.push('Is my recovery holding back my progress?');
  if (routine.untracked.length > 0) out.push(`Where should ${routine.untracked[0].name} go in my plan?`);
  if (out.length < 3) out.push('What should I focus on in my next session?');
  return out.slice(0, 4);
}

export function recoverySuggestions(routine: RoutineOverview): string[] {
  const out = ['Is my recovery holding back my progress?'];
  const d = routine.deload.status;
  if (d === 'due' || d === 'overdue') out.push('Should I start a deload this week?', "I'm starting a deload today — please record it.");
  const tripped = routine.recovery.indicators.find(i => i.status === 'warn' || i.status === 'watch');
  if (tripped) out.push(`What can I do about my ${tripped.label.toLowerCase()}?`);
  if (out.length < 3) out.push('How is my routine going?');
  return out.slice(0, 4);
}

export function pathSuggestions(path: PathProgress): string[] {
  const name = path.pathName.toLowerCase();
  const out = [`How is my ${name} progression going?`];
  if (path.hold) out.push(`Is it time to clear the ${path.hold.kind === 'regress' ? 'regression' : 'hold'} on ${name}?`);
  else if ((path.light === 'green' || path.light === 'yellow-green') && path.nextStage) out.push(`Am I ready to move to ${path.nextStage.name}?`);
  else out.push(`What should I do in my next ${path.stage.name.toLowerCase()} session?`);
  const light = LIGHT_WORD[path.light];
  out.push(light ? `Why is this path ${light}?` : 'Why does this path have no light yet?');
  return out;
}

export function workoutSuggestions(workout: WorkoutView): string[] {
  const slots = workout.domains.flatMap(d => d.slots);
  const out = [`Walk me through ${workout.name} — what should I do in each exercise next time?`];
  if (slots.some(s => s.suggestion?.status === 'ready')) out.push('Which exercises in this workout are ready to progress?');
  out.push(`How is my progress on ${workout.name}?`);
  out.push(`Can I shorten ${workout.name} to fit less time?`);
  return out.slice(0, 4);
}

export function untrackedSuggestions(exercise: { name: string; sessions: number; lastDate: string }): string[] {
  const s = exercise.sessions === 1 ? '' : 's';
  return [
    `I log "${exercise.name}" in my workouts (${exercise.sessions} session${s} in the last 90 days, most recently ${exercise.lastDate}) but no path in my plan tracks it. Add it to the plan where it belongs.`,
    `Which path in my plan should ${exercise.name} count toward?`,
  ];
}
