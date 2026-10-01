// ── Untracked exercises ─────────────────────────────────
//
// Paths recognise sessions by the exercise names (and source template ids) their
// stages list. An exercise the reader logs under another name — "Bent Over Row
// (Band)" when the row path lists "Inverted Row" — is silently ignored, so a
// milestone they have already reached looks unmet. This lists recent exercises
// no stage recognises, so the page and the analyst can offer to add them.

import { addDays } from '../analytics/windows';
import { stageMatchesExercise } from './records';
import type { TrainingPlan } from './types';
import type { TrainingSession } from '../workout-sources/types';

export interface UntrackedExercise {
  name: string;
  templateId: string | null;
  /** Sessions in the window that include it with at least one working set. */
  sessions: number;
  lastDate: string;
}

export const UNTRACKED_WINDOW_DAYS = 90;

export function untrackedExercises(
  plan: TrainingPlan,
  sessions: TrainingSession[],
  dayOf: (iso: string) => string,
  today: string,
  windowDays = UNTRACKED_WINDOW_DAYS
): UntrackedExercise[] {
  const from = addDays(today, -(windowDays - 1));
  const stages = plan.focusAreas.flatMap(a => a.paths.flatMap(p => p.stages));
  const found = new Map<string, UntrackedExercise & { seen: Set<string> }>();
  for (const session of sessions) {
    const date = dayOf(session.startTime);
    if (date < from || date > today) continue;
    for (const e of session.exercises) {
      if (!e.sets.some(s => s.kind !== 'warmup')) continue;
      if (stages.some(stage => stageMatchesExercise(stage, e.sourceTemplateId, e.name))) continue;
      const key = e.sourceTemplateId ?? `name:${e.name.toLowerCase()}`;
      const entry = found.get(key) ?? { name: e.name, templateId: e.sourceTemplateId, sessions: 0, lastDate: date, seen: new Set<string>() };
      if (!entry.seen.has(session.id)) {
        entry.seen.add(session.id);
        entry.sessions += 1;
      }
      if (date >= entry.lastDate) {
        entry.lastDate = date;
        entry.name = e.name;
      }
      found.set(key, entry);
    }
  }
  return [...found.values()]
    .map(({ seen: _seen, ...rest }) => rest)
    .sort((a, b) => b.sessions - a.sessions || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}
