// ── Deloads: planned, recorded, or read from the sessions ──
//
// A deload is a week of lighter work on purpose. Its sessions say nothing about
// progress either way, so the models leave them out of the light and readiness
// (they still show in the table) — progress is paused, not regressed.
//
// A session is EASED when its work fell clearly below the stage's recent
// sessions AND its top RPE fell with it: fewer reps at the same or higher
// effort is a bad day, fewer reps at a clearly lower effort is a choice.
//
//   a deload window    7 days from a recorded or detected start, or a deload block
//   a detected start   a day where at least two paths, and at least half of the
//                      paths trained, had eased sessions (outside any window)
//   inside a window    a drop in work alone is enough (effort may be unlogged)
//   outside a window   a lone eased session is still paused, but starts nothing

import { addDays } from '../analytics/windows';
import type { PerformanceRecord } from './records';
import type { TrainingPlan } from './types';

/** Days a recorded or detected deload lasts. */
export const DELOAD_DAYS = 7;
/** Work at or below this share of the recent sessions counts as lighter. */
const LIGHTER = 0.85;
/** Top RPE at least this much below the recent sessions counts as easier. */
const EASIER_RPE = 1;
/** Recent sessions of the stage the reference is taken from. */
const REFERENCE = 3;

export interface DeloadWindow {
  from: string;
  to: string;
  source: 'block' | 'recorded' | 'detected';
}

export interface DeloadDetection {
  /** Days a deload was read from the sessions. */
  starts: string[];
  /** Every window: blocks, recorded and detected. */
  windows: DeloadWindow[];
  /** Per path, the eased sessions as `stageId:sessionId`. */
  eased: Map<string, Set<string>>;
}

/** Key of one stage's record of a session (a session can hold several paths' work). */
export function easedKey(stageId: string, sessionId: string): string {
  return `${stageId}:${sessionId}`;
}

/** Windows the plan knows about: deload blocks and recorded deloads. */
export function plannedWindows(plan: TrainingPlan): DeloadWindow[] {
  return [
    ...plan.blocks
      .filter(b => b.kind === 'deload')
      .map(b => {
        const from = addDays(plan.startDate, (b.startWeek - 1) * 7);
        return { from, to: addDays(from, b.weeks * 7 - 1), source: 'block' as const };
      }),
    ...plan.deloads.map(from => ({ from, to: addDays(from, DELOAD_DAYS - 1), source: 'recorded' as const })),
  ];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One comparable amount of work, chosen by what the record carries. */
function measureOf(record: PerformanceRecord): (r: PerformanceRecord) => number {
  const t = record.totals;
  if (record.loadMeaning === 'added' && t.tonnageKg > 0) return r => r.totals.tonnageKg;
  if (t.reps > 0) return r => r.totals.reps;
  if (t.durationS > 0) return r => r.totals.durationS;
  return r => r.totals.distanceM;
}

/** How a record compares with the stage's recent (non-eased) sessions before it. */
export function drops(record: PerformanceRecord, prior: PerformanceRecord[]): { lighter: boolean; easier: boolean } {
  const ref = prior.slice(-REFERENCE);
  if (ref.length === 0) return { lighter: false, easier: false };
  const measure = measureOf(record);
  const refWork = median(ref.map(measure));
  const lighter = refWork > 0 && measure(record) <= refWork * LIGHTER;
  const rpe = record.totals.topRpe;
  const refRpes = ref.map(r => r.totals.topRpe).filter((x): x is number => x !== null);
  const easier = rpe !== null && refRpes.length > 0 && rpe <= median(refRpes) - EASIER_RPE;
  return { lighter, easier };
}

/**
 * Walks the training days in order, judging each stage's sessions against the
 * stage's recent sessions, and returns the deloads read from them and the
 * sessions to pause.
 */
export function detectDeloads(plan: TrainingPlan, recordsByPath: Map<string, Map<string, PerformanceRecord[]>>): DeloadDetection {
  const windows = plannedWindows(plan);
  const inWindow = (day: string) => windows.some(w => day >= w.from && day <= w.to);

  const byDay = new Map<string, { pathId: string; stageId: string; record: PerformanceRecord }[]>();
  for (const [pathId, byStage] of recordsByPath) {
    for (const [stageId, records] of byStage) {
      for (const record of records) byDay.set(record.date, [...(byDay.get(record.date) ?? []), { pathId, stageId, record }]);
    }
  }

  const history = new Map<string, PerformanceRecord[]>();
  const eased = new Map<string, Set<string>>();
  const starts: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const entries = byDay.get(day)!.sort((a, b) => a.record.startTime.localeCompare(b.record.startTime));
    const judged = entries.map(e => ({ ...e, key: `${e.pathId}:${e.stageId}`, ...drops(e.record, history.get(`${e.pathId}:${e.stageId}`) ?? []) }));
    const trained = new Set(entries.map(e => e.pathId));
    const easy = new Set(judged.filter(j => j.lighter && j.easier).map(j => j.pathId));
    if (!inWindow(day) && easy.size >= 2 && easy.size * 2 >= trained.size) {
      windows.push({ from: day, to: addDays(day, DELOAD_DAYS - 1), source: 'detected' });
      starts.push(day);
    }
    const within = inWindow(day);
    for (const j of judged) {
      if (within ? j.lighter : j.lighter && j.easier) {
        eased.set(j.pathId, (eased.get(j.pathId) ?? new Set()).add(easedKey(j.stageId, j.record.sessionId)));
      } else {
        history.set(j.key, [...(history.get(j.key) ?? []), j.record]);
      }
    }
  }
  return { starts, windows, eased };
}

/** The window covering a day, the latest-starting one when several do. */
export function windowOn(windows: DeloadWindow[], day: string): DeloadWindow | null {
  return windows.filter(w => day >= w.from && day <= w.to).sort((a, b) => a.from.localeCompare(b.from)).pop() ?? null;
}
