// ── Workouts: one session template, seen as a day of training ──
//
// A plan's session templates ("Workout A: Upper body", "Long run", "Light full
// body") point at paths through their slots. This view turns one template into
// what that day trains: the domains (focus areas) it covers, each slot's current
// exercise and light, and — once a path is at yellow-green or green — what comes
// next on it. Nothing here is discipline-specific: a slot is a path, and "next"
// is the path's next step or stage, whatever those are.

import type { UnitSystem } from '../prefs';
import { doseText } from './format';
import type { Light, Readiness } from './models/types';
import type { DeloadStatus } from './position';
import type { PathProgress } from './progress';
import { slotPath, type CompletedSession, type NextSessionView, type ScheduledDayView } from './schedule';
import type { Path, TrainingPlan } from './types';
import { currentStage, findPath, nextStage } from './validate';

export interface WorkoutSuggestion {
  kind: 'step' | 'stage';
  name: string;
  /** What the next step or stage asks for, e.g. "3–4 × 8–12". */
  dose: string;
  /** green → ready now; yellow-green → close, not yet. */
  status: 'ready' | 'nearly';
  text: string;
}

export interface WorkoutSlotView {
  pathId: string;
  pathName: string;
  stageName: string;
  stepName?: string;
  dose: string;
  optional: boolean;
  note?: string;
  /** Names of the other paths a rotating (or pick-one) slot covers. */
  rotatesWith: string[];
  light: Light;
  /** See `PathProgress.tracked`. */
  tracked: boolean;
  readiness: Readiness | null;
  lastSession: { date: string; work: string } | null;
  cues: string[];
  onHold: boolean;
  /** The next step or stage on the path, whatever the light. */
  nextName: string | null;
  suggestion: WorkoutSuggestion | null;
  /** At yellow-green or green on the path's last stage: nothing further to suggest. */
  topOfPath: boolean;
}

export interface WorkoutDomainView {
  areaId: string;
  areaName: string;
  slots: WorkoutSlotView[];
}

export interface WorkoutView {
  id: string;
  name: string;
  minutes?: number;
  warmup: string[];
  /** "Due today", "Next up", "After Workout B", "After a rest day", "Next on Wed" — null when not coming up soon. */
  when: string | null;
  lastDone: string | null;
  timesDone: number;
  domains: WorkoutDomainView[];
}

const hasTemplate = (day: ScheduledDayView, id: string) => day.kind === 'train' && day.templates.some(t => t.id === id);

/** When this template comes up, named by the day just before it in the schedule. */
export function workoutWhen(next: NextSessionView, templateId: string): string | null {
  if (hasTemplate(next.due, templateId)) return next.doneToday ? 'Next up' : 'Due today';
  const i = next.upcoming.findIndex(d => hasTemplate(d, templateId));
  if (i < 0) return null;
  if (next.scheduleKind === 'weekdays') return `Next on ${next.upcoming[i].label.split(':')[0]}`;
  const before = i === 0 ? next.due : next.upcoming[i - 1];
  if (before.kind === 'train') return `After ${before.label}`;
  return before === next.due ? "Next, after today's rest" : 'After a rest day';
}

/** What comes after the path's current position: its next step, else its next stage. */
function nextOnPath(path: Path, system: UnitSystem): { kind: 'step' | 'stage'; name: string; dose: string } | null {
  const stage = currentStage(path);
  const step = path.currentStepIndex !== undefined ? stage.steps?.[path.currentStepIndex + 1] : undefined;
  if (step) return { kind: 'step', name: step.name, dose: doseText(step.advanceWhen, system) };
  const following = nextStage(path);
  return following ? { kind: 'stage', name: following.name, dose: doseText(following.prescription ?? following.advanceWhen, system) } : null;
}

function suggestionFor(
  progress: PathProgress,
  upNext: ReturnType<typeof nextOnPath>,
  deload: DeloadStatus
): { suggestion: WorkoutSuggestion | null; topOfPath: boolean } {
  if (progress.hold || (progress.light !== 'green' && progress.light !== 'yellow-green')) return { suggestion: null, topOfPath: false };
  if (!upNext) return { suggestion: null, topOfPath: true };
  const { kind, name, dose } = upNext;
  const status = progress.light === 'green' ? 'ready' : 'nearly';
  const target = kind === 'step' ? `the next step, ${name}` : name;
  const deloading = deload.status === 'in-deload' || deload.status === 'overdue';
  const text =
    status === 'ready'
      ? deloading
        ? `Ready for ${target} once the deload is done.`
        : `Ready: move to ${target}${dose ? ` (${dose})` : ''}.`
      : `Nearly there: ${target} is next once this turns green.`;
  return { suggestion: { kind, name, dose, status, text }, topOfPath: false };
}

/** Every session template of the plan, as a day of training. */
export function workoutViews(
  plan: TrainingPlan,
  paths: PathProgress[],
  completed: CompletedSession[],
  next: NextSessionView,
  deload: DeloadStatus,
  system: UnitSystem
): WorkoutView[] {
  const byId = new Map(paths.map(p => [p.pathId, p]));
  return plan.templates.map(t => {
    const done = completed.filter(c => c.templateId === t.id);
    const domains: WorkoutDomainView[] = [];
    for (const slot of t.slots) {
      const { pathId, others } = slotPath(slot, done.length);
      const progress = byId.get(pathId);
      const hit = findPath(plan, pathId);
      if (!progress || !hit) continue;
      const stage = currentStage(hit.path);
      const upNext = nextOnPath(hit.path, system);
      const view: WorkoutSlotView = {
        pathId,
        pathName: progress.pathName,
        stageName: progress.stage.name,
        ...(progress.step ? { stepName: progress.step.name } : {}),
        dose: doseText(slot.dose ?? stage.prescription ?? stage.advanceWhen, system),
        optional: Boolean(slot.optional),
        ...(slot.note ? { note: slot.note } : {}),
        rotatesWith: others.map(id => byId.get(id)?.pathName ?? id),
        light: progress.light,
        tracked: progress.tracked,
        readiness: progress.readiness,
        lastSession: progress.lastSession,
        cues: progress.cues,
        onHold: Boolean(progress.hold),
        nextName: upNext?.name ?? null,
        ...suggestionFor(progress, upNext, deload),
      };
      let domain = domains.find(d => d.areaId === progress.areaId);
      if (!domain) {
        domain = { areaId: progress.areaId, areaName: progress.areaName, slots: [] };
        domains.push(domain);
      }
      domain.slots.push(view);
    }
    return {
      id: t.id,
      name: t.name,
      ...(t.minutes ? { minutes: t.minutes } : {}),
      warmup: t.warmup ?? [],
      when: workoutWhen(next, t.id),
      lastDone: done.length ? done[done.length - 1].date : null,
      timesDone: done.length,
      domains,
    };
  });
}
