// ── Schedule: what is next, and how closely it is followed ──
//
// A plan's schedule is one of three shapes (types.ts `Schedule`), none of them
// privileged:
//
//   cycle      any length — [A, B, rest], [Full, rest], [Light full body],
//              PPL-PPL-rest — advancing when a session is logged, or by calendar
//   weekdays   fixed days — Mon: Upper, Wed: Lower, Sat: Long run
//   frequency  N sessions a week on any days, rotating through templates
//
// Logged sessions are attributed to the template whose paths they trained, so
// "what is next" follows what the user actually did, not an idealised calendar.

import { addDays, dayKeyToDate, diffDays } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import { doseText } from './format';
import { stageMatchesExercise } from './records';
import { currentStage, findPath } from './validate';
import { WEEKDAYS, type Schedule, type ScheduleDay, type SessionTemplate, type TemplateSlot, type TrainingPlan } from './types';
import type { WorkoutRecord } from '../metrics/types';
import type { TrainingSession } from '../workout-sources/types';

export interface CompletedSession {
  date: string;
  templateId: string;
  sessionId: string;
}

export interface SlotView {
  pathId: string;
  pathName: string;
  stageName: string;
  dose: string;
  optional: boolean;
  /** For a rotating slot: the other paths it cycles through. */
  rotatesWith: string[];
  note?: string;
}

export interface ScheduledDayView {
  kind: 'train' | 'rest';
  label: string;
  templates: { id: string; name: string; minutes?: number; warmup: string[]; slots: SlotView[] }[];
  note?: string;
}

export interface NextSessionView {
  scheduleKind: Schedule['kind'];
  /** What is due now. */
  due: ScheduledDayView;
  /** True when a session was already logged today. */
  doneToday: boolean;
  /** A short explanation: "Follows Workout B on Sep 15", "2 of 3–4 this week". */
  why: string;
  upcoming: ScheduledDayView[];
}

export interface Adherence {
  windowDays: number;
  planned: number;
  completed: number;
  ratio: number | null;
  status: 'ok' | 'watch' | 'unknown';
  text: string;
}

// ── Attributing sessions to templates ───────────────────

function templateScore(plan: TrainingPlan, template: SessionTemplate, names: { templateId: string | null; name: string }[], workoutType?: string): number {
  let score = 0;
  for (const slot of template.slots) {
    for (const pathId of slot.pathIds) {
      const hit = findPath(plan, pathId);
      if (!hit) continue;
      const matched = hit.path.stages.some(
        stage =>
          names.some(n => stageMatchesExercise(stage, n.templateId, n.name)) ||
          (workoutType !== undefined && (stage.match.workoutTypes ?? []).some(t => t.toLowerCase() === workoutType.toLowerCase()))
      );
      if (matched) {
        score += slot.optional ? 0.5 : 1;
        break;
      }
    }
  }
  return score;
}

/** Each logged session → the template it most resembles (if any), oldest first. */
export function completedSessions(
  plan: TrainingPlan,
  sessions: TrainingSession[],
  workouts: WorkoutRecord[],
  dayOf: (iso: string) => string
): CompletedSession[] {
  const out: CompletedSession[] = [];
  const consider = (id: string, start: string, names: { templateId: string | null; name: string }[], workoutType?: string) => {
    const date = dayOf(start);
    if (date < plan.startDate) return;
    let best: SessionTemplate | null = null;
    let bestScore = 0;
    for (const t of plan.templates) {
      const s = templateScore(plan, t, names, workoutType);
      if (s > bestScore) {
        best = t;
        bestScore = s;
      }
    }
    if (best) out.push({ date, templateId: best.id, sessionId: id });
  };
  for (const s of sessions) consider(s.id, s.startTime, s.exercises.map(e => ({ templateId: e.sourceTemplateId, name: e.name })));
  for (const w of workouts) consider(`hae:${w.id}`, w.start_time, [], w.workout_type);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Views ───────────────────────────────────────────────

export function rotationIndex(completed: CompletedSession[], templateId: string): number {
  return completed.filter(c => c.templateId === templateId).length;
}

/** The path a slot trains next: a rotating slot moves on with each logged session of its template. */
export function slotPath(slot: TemplateSlot, timesDone: number): { pathId: string; others: string[] } {
  const pathId = slot.rotate ? slot.pathIds[timesDone % slot.pathIds.length] : slot.pathIds[0];
  return { pathId, others: slot.rotate ? slot.pathIds.filter(p => p !== pathId) : slot.pathIds.slice(1) };
}

function dayView(plan: TrainingPlan, day: ScheduleDay, completed: CompletedSession[], system: UnitSystem): ScheduledDayView {
  if ('rest' in day) return { kind: 'rest', label: 'Rest day', templates: [], ...(day.note ? { note: day.note } : {}) };
  const templates = day.templateIds
    .map(id => plan.templates.find(t => t.id === id))
    .filter((t): t is SessionTemplate => Boolean(t))
    .map(t => {
      const done = rotationIndex(completed, t.id);
      const slots: SlotView[] = t.slots.flatMap(slot => {
        const { pathId, others } = slotPath(slot, done);
        const hit = findPath(plan, pathId);
        if (!hit) return [];
        const stage = currentStage(hit.path);
        return [{
          pathId,
          pathName: hit.path.name,
          stageName: stage.name,
          dose: doseText(slot.dose ?? stage.prescription ?? stage.advanceWhen, system),
          optional: Boolean(slot.optional),
          rotatesWith: others,
          ...(slot.note ? { note: slot.note } : {}),
        }];
      });
      return { id: t.id, name: t.name, ...(t.minutes ? { minutes: t.minutes } : {}), warmup: t.warmup ?? [], slots };
    });
  return { kind: 'train', label: templates.map(t => t.name).join(' + ') || 'Training', templates, ...(day.note ? { note: day.note } : {}) };
}

export function isTraining(day: ScheduleDay): day is { templateIds: string[]; note?: string } {
  return !('rest' in day);
}

/** Which schedule applies this week (a block may override the plan's). */
export function activeSchedule(plan: TrainingPlan, week: number): Schedule {
  const override = plan.blocks.find(b => b.scheduleOverride && week >= b.startWeek && week < b.startWeek + b.weeks);
  return override?.scheduleOverride ?? plan.schedule;
}

export function weekdayOf(key: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[(dayKeyToDate(key).getUTCDay() + 6) % 7];
}

export function mondayOf(key: string): string {
  return addDays(key, -((dayKeyToDate(key).getUTCDay() + 6) % 7));
}

/** The anchor a calendar-advancing cycle counts from. */
export function cycleAnchor(plan: TrainingPlan, schedule: Extract<Schedule, { kind: 'cycle' }>): string {
  return schedule.anchorDate ?? plan.startDate;
}

/**
 * Which day of a cycle is due today. On completion, the logged sessions are
 * walked through the cycle and rest days are used up by the calendar days that
 * have passed since the last one; by calendar, it is counted from the anchor.
 */
export function cyclePosition(
  plan: TrainingPlan,
  schedule: Extract<Schedule, { kind: 'cycle' }>,
  completed: CompletedSession[],
  today: string
): number {
  const days = schedule.days;
  const n = days.length;
  if (schedule.advance === 'calendar') return ((diffDays(cycleAnchor(plan, schedule), today) % n) + n) % n;
  let pos = -1;
  for (const c of completed) {
    for (let k = 1; k <= n; k++) {
      const j = (pos + k) % n;
      const d = days[j];
      if (isTraining(d) && d.templateIds.includes(c.templateId)) {
        pos = j;
        break;
      }
    }
  }
  let idx = (pos + 1) % n;
  const last = completed[completed.length - 1];
  if (last && last.date !== today) {
    let cursor = addDays(last.date, 1);
    while (!isTraining(days[idx]) && cursor < today) {
      idx = (idx + 1) % n;
      cursor = addDays(cursor, 1);
    }
  }
  return idx;
}

export function nextSession(
  plan: TrainingPlan,
  completed: CompletedSession[],
  today: string,
  week: number,
  system: UnitSystem
): NextSessionView {
  const schedule = activeSchedule(plan, week);
  const last = completed[completed.length - 1];
  const doneToday = last?.date === today;
  const view = (d: ScheduleDay) => dayView(plan, d, completed, system);

  if (schedule.kind === 'cycle') {
    const days = schedule.days;
    const n = days.length;
    const idx = cyclePosition(plan, schedule, completed, today);
    const upcoming = [1, 2, 3].map(k => view(days[(idx + k) % n]));
    if (schedule.advance === 'calendar') {
      const why = `Day ${idx + 1} of the ${n}-day cycle (counted from ${cycleAnchor(plan, schedule)}).`;
      return { scheduleKind: 'cycle', due: view(days[idx]), doneToday, why, upcoming };
    }
    const lastName = last ? (plan.templates.find(t => t.id === last.templateId)?.name ?? null) : null;
    const why = !last
      ? 'Start of the cycle.'
      : doneToday
        ? `Already trained today; next up after ${lastName ?? 'it'}.`
        : `Follows ${lastName ?? 'the last session'} on ${last.date}.`;
    return { scheduleKind: 'cycle', due: view(days[idx]), doneToday, why, upcoming };
  }

  if (schedule.kind === 'weekdays') {
    const at = (key: string): ScheduleDay => schedule.days[weekdayOf(key)] ?? { rest: true };
    const upcoming: ScheduledDayView[] = [];
    for (let k = 1; upcoming.length < 3 && k <= 7; k++) {
      const d = at(addDays(today, k));
      if (isTraining(d)) upcoming.push({ ...view(d), label: `${weekdayOf(addDays(today, k)).replace(/^./, c => c.toUpperCase())}: ${view(d).label}` });
    }
    return { scheduleKind: 'weekdays', due: view(at(today)), doneToday, why: `${weekdayOf(today).replace(/^./, c => c.toUpperCase())} in the weekly schedule.`, upcoming };
  }

  // Frequency: rotate templates; rest when this week's range is met or rest is too short.
  const monday = mondayOf(today);
  const thisWeek = completed.filter(c => c.date >= monday && c.date <= today).length;
  const [lo, hi] = schedule.sessionsPerWeek;
  const nextTemplate = schedule.rotation[completed.length % schedule.rotation.length];
  const lastGapHours = last ? diffDays(last.date, today) * 24 : Infinity;
  const tooSoon = schedule.minRestHours !== undefined && lastGapHours < schedule.minRestHours;
  const rest = doneToday || thisWeek >= hi || tooSoon;
  const due = rest ? { kind: 'rest' as const, label: 'Rest day', templates: [] } : view({ templateIds: [nextTemplate] });
  return {
    scheduleKind: 'frequency',
    due,
    doneToday,
    why: `${thisWeek} of ${lo === hi ? lo : `${lo}–${hi}`} sessions this week${tooSoon ? '; the minimum rest has not passed yet' : ''}.`,
    upcoming: [0, 1, 2].map(k => view({ templateIds: [schedule.rotation[(completed.length + k + (rest ? 0 : 1)) % schedule.rotation.length]] })),
  };
}

/** Planned versus logged sessions over the last two weeks (or since the plan began). */
export function adherence(plan: TrainingPlan, completed: CompletedSession[], today: string, week: number): Adherence {
  const from = [addDays(today, -13), plan.startDate].sort()[1];
  const windowDays = Math.max(1, diffDays(from, today) + 1);
  const done = completed.filter(c => c.date >= from && c.date <= today).length;
  const schedule = activeSchedule(plan, week);
  let planned: number;
  if (schedule.kind === 'cycle') {
    const training = schedule.days.filter(isTraining).length;
    planned = Math.round((windowDays * training) / schedule.days.length);
  } else if (schedule.kind === 'weekdays') {
    planned = 0;
    for (let k = 0; k < windowDays; k++) {
      const d = schedule.days[weekdayOf(addDays(from, k))];
      if (d && isTraining(d)) planned++;
    }
  } else {
    planned = Math.round((windowDays / 7) * schedule.sessionsPerWeek[0]);
  }
  if (planned === 0) return { windowDays, planned, completed: done, ratio: null, status: 'unknown', text: 'Nothing was scheduled in this window.' };
  const ratio = done / planned;
  return {
    windowDays,
    planned,
    completed: done,
    ratio,
    status: ratio < 0.7 ? 'watch' : 'ok',
    text: `${done} of ${planned} planned sessions in the last ${windowDays} days.`,
  };
}
