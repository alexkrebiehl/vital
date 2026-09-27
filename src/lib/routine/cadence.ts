// ── Cadence: the rhythm of training and rest days ───────
//
// A plan's schedule as something to look at: the repeating pattern (a cycle's
// days, or a frequency plan's rotation) with the reader's place in it, and this
// week from Monday to Sunday — what was logged, and what the schedule expects
// for the days still ahead. Works for every schedule shape in types.ts.
//
// Past days with nothing logged are left plain: the strip shows what happened
// and what is expected, never a verdict on missed days.

import { addDays, diffDays, formatDayKeyShort } from '../analytics/windows';
import {
  cycleAnchor,
  cyclePosition,
  isTraining,
  mondayOf,
  weekdayOf,
  type CompletedSession,
  type NextSessionView,
} from './schedule';
import { WEEKDAYS, type Schedule, type ScheduleDay, type TrainingPlan } from './types';

export interface CadenceTemplate {
  id: string;
  name: string;
}

export interface CadenceNode {
  kind: 'train' | 'rest';
  /** Empty for a rest day. */
  templates: CadenceTemplate[];
  note?: string;
  /** Where the reader is in the pattern: due today, or next once today is logged. */
  current: 'today' | 'next' | null;
}

export interface CadenceDay {
  date: string;
  /** "Mon" */
  weekday: string;
  isToday: boolean;
  /** Sessions logged that day, by the workout they were attributed to. */
  logged: CadenceTemplate[];
  /** What the schedule expects, for today (until something is logged) and later; null for past days. */
  expected: { kind: 'train' | 'rest' | 'open'; templates: CadenceTemplate[] } | null;
}

export interface CadenceView {
  kind: Schedule['kind'];
  /** A cycle's days in order, or a frequency plan's rotation. Empty for weekdays: the week is the pattern. */
  pattern: CadenceNode[];
  /** "3-day cycle · moves on when you log a session" */
  caption: string;
  /** Monday to Sunday of the current week. */
  week: CadenceDay[];
  /** "2 sessions logged this week", or "2 of 3–4 this week" for a frequency plan. */
  weekSummary: string;
}

const dayName = (key: string) => {
  const d = weekdayOf(key);
  return d.charAt(0).toUpperCase() + d.slice(1);
};

const countText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function cadenceView(
  plan: TrainingPlan,
  completed: CompletedSession[],
  next: NextSessionView,
  today: string,
  week: number
): CadenceView {
  const override = plan.blocks.find(b => b.scheduleOverride && week >= b.startWeek && week < b.startWeek + b.weeks);
  const schedule = override?.scheduleOverride ?? plan.schedule;
  const nameOf = (id: string): CadenceTemplate => ({ id, name: plan.templates.find(t => t.id === id)?.name ?? id });
  const expectedFor = (day: ScheduleDay): NonNullable<CadenceDay['expected']> =>
    isTraining(day) ? { kind: 'train', templates: day.templateIds.map(nameOf) } : { kind: 'rest', templates: [] };
  const mark: CadenceNode['current'] = next.doneToday ? 'next' : 'today';

  const monday = mondayOf(today);
  const dates = Array.from({ length: 7 }, (_, k) => addDays(monday, k));
  const thisWeek = completed.filter(c => c.date >= monday && c.date <= today);
  // The schedule's expectations start with the first day not yet logged.
  const firstOpen = next.doneToday ? addDays(today, 1) : today;

  let pattern: CadenceNode[] = [];
  let caption: string;
  let expectedOn: (date: string) => CadenceDay['expected'];
  let weekSummary = thisWeek.length
    ? `${countText(thisWeek.length, 'session', 'sessions')} logged this week`
    : 'No sessions logged yet this week';

  if (schedule.kind === 'cycle') {
    const n = schedule.days.length;
    const idx = cyclePosition(plan, schedule, completed, today);
    pattern = schedule.days.map((d, i) => ({
      kind: isTraining(d) ? 'train' : 'rest',
      templates: isTraining(d) ? d.templateIds.map(nameOf) : [],
      ...(d.note ? { note: d.note } : {}),
      current: i === idx ? mark : null,
    }));
    if (schedule.advance === 'calendar') {
      const anchor = cycleAnchor(plan, schedule);
      caption = `${n}-day cycle · follows the calendar from ${formatDayKeyShort(anchor)}`;
      expectedOn = date => expectedFor(schedule.days[((diffDays(anchor, date) % n) + n) % n]);
    } else {
      caption = `${n}-day cycle · moves on when you log a session`;
      // Assumes the cycle is followed from here: one cycle day per calendar day.
      expectedOn = date => expectedFor(schedule.days[(idx + diffDays(firstOpen, date)) % n]);
    }
  } else if (schedule.kind === 'weekdays') {
    const trainingDays = WEEKDAYS.filter(w => {
      const d = schedule.days[w];
      return d && isTraining(d);
    });
    caption = `Weekly: ${trainingDays.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ') || 'no training days'}`;
    expectedOn = date => expectedFor(schedule.days[weekdayOf(date)] ?? { rest: true });
  } else {
    const [lo, hi] = schedule.sessionsPerWeek;
    const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
    const r = schedule.rotation.length;
    const at = completed.length % r;
    pattern = schedule.rotation.map((id, i) => ({
      kind: 'train',
      templates: [nameOf(id)],
      current: i === at ? (next.due.kind === 'train' ? mark : 'next') : null,
    }));
    caption = `${range} sessions a week, rotating${schedule.minRestHours ? ` · at least ${schedule.minRestHours} h between` : ''}`;
    weekSummary = `${thisWeek.length} of ${range} this week`;
    // No fixed days: once the week's range is met, the rest of it is rest.
    expectedOn = () => (thisWeek.length >= hi ? { kind: 'rest', templates: [] } : { kind: 'open', templates: [] });
  }
  if (override) caption += ` (${override.name} schedule)`;

  const days: CadenceDay[] = dates.map(date => ({
    date,
    weekday: dayName(date),
    isToday: date === today,
    logged: completed.filter(c => c.date === date).map(c => nameOf(c.templateId)),
    expected: date >= firstOpen && date >= plan.startDate ? expectedOn(date) : null,
  }));

  return { kind: schedule.kind, pattern, caption, week: days, weekSummary };
}
