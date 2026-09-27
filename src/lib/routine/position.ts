// ── Where the reader is in the plan ─────────────────────
//
//   planWeek        1-based week of the plan for a day (clamped to the plan)
//   planPosition    every block with its status and whether its targets were met
//   deloadStatus    weeks since the last deload against the plan's rule
//
// Target checks use the logged sessions of the target's path: a target counts
// as met when any session from the block's start onward reached its dose.

import { addDays, diffDays } from '../analytics/windows';
import type { UnitSystem } from '../prefs';
import { doseText } from './format';
import { judge } from './models/variation';
import { quantityFor } from './models/shared';
import type { PerformanceRecord } from './records';
import type { Block, TrainingPlan } from './types';

export function planWeek(plan: TrainingPlan, today: string): number {
  const days = diffDays(plan.startDate, today);
  return Math.min(plan.durationWeeks, Math.max(1, Math.floor(days / 7) + 1));
}

export function planStarted(plan: TrainingPlan, today: string): boolean {
  return today >= plan.startDate;
}

export function blockDates(plan: TrainingPlan, block: Block): { from: string; to: string } {
  const from = addDays(plan.startDate, (block.startWeek - 1) * 7);
  return { from, to: addDays(from, block.weeks * 7 - 1) };
}

export function currentBlocks(plan: TrainingPlan, week: number): Block[] {
  return plan.blocks.filter(b => week >= b.startWeek && week < b.startWeek + b.weeks);
}

export interface BlockTargetView {
  label: string;
  pathId?: string;
  dose: string;
  /** null when the target has no dose or no path to check against. */
  met: boolean | null;
}

export interface BlockView {
  id: string;
  name: string;
  kind?: Block['kind'];
  from: string;
  to: string;
  weeks: [number, number];
  goals: string[];
  targets: BlockTargetView[];
  /** `elapsed`: over, but none of its targets can be checked against sessions. */
  status: 'complete' | 'behind' | 'elapsed' | 'current' | 'future';
}

export function planPosition(
  plan: TrainingPlan,
  recordsByPath: Map<string, PerformanceRecord[]>,
  today: string,
  system: UnitSystem
): BlockView[] {
  const week = planWeek(plan, today);
  return plan.blocks.map(block => {
    const { from, to } = blockDates(plan, block);
    const targets: BlockTargetView[] = block.targets.map(t => {
      let met: boolean | null = null;
      if (t.dose && t.pathId) {
        const records = (recordsByPath.get(t.pathId) ?? []).filter(r => r.date >= from && r.date <= today);
        const q = quantityFor(t.dose, records);
        met = records.some(r => judge(r, t.dose, q, null).inRange);
      }
      return { label: t.label, ...(t.pathId ? { pathId: t.pathId } : {}), dose: doseText(t.dose, system), met };
    });
    const started = planStarted(plan, today);
    const status: BlockView['status'] =
      !started || week < block.startWeek
        ? 'future'
        : week < block.startWeek + block.weeks && today <= to
          ? 'current'
          : targets.some(t => t.met === false)
            ? 'behind'
            : targets.some(t => t.met === true)
              ? 'complete'
              : 'elapsed';
    return {
      id: block.id,
      name: block.name,
      ...(block.kind ? { kind: block.kind } : {}),
      from,
      to,
      weeks: [block.startWeek, block.startWeek + block.weeks - 1],
      goals: block.goals,
      targets,
      status,
    };
  });
}

export interface DeloadStatus {
  /** Days a deload started (blocks already begun, plus logged deloads). */
  lastDeload: string | null;
  weeksSince: number;
  status: 'none' | 'ok' | 'due' | 'overdue' | 'in-deload';
  text: string;
}

export function deloadStatus(plan: TrainingPlan, today: string): DeloadStatus {
  const week = planWeek(plan, today);
  const inBlock = currentBlocks(plan, week).find(b => b.kind === 'deload');
  if (inBlock) return { lastDeload: blockDates(plan, inBlock).from, weeksSince: 0, status: 'in-deload', text: `${inBlock.name} is running this week.` };
  const starts = [
    ...plan.blocks.filter(b => b.kind === 'deload').map(b => blockDates(plan, b).from),
    ...plan.deloads,
  ].filter(d => d <= today);
  const lastDeload = starts.sort().pop() ?? null;
  const since = Math.floor(diffDays(lastDeload ?? plan.startDate, today) / 7);
  const rule = plan.rules.deload;
  if (!rule) return { lastDeload, weeksSince: since, status: 'none', text: 'This plan has no deload rule.' };
  const [lo, hi] = rule.everyWeeks;
  const reduce = `${Math.round(rule.volumeReduction[0] * 100)}–${Math.round(rule.volumeReduction[1] * 100)}%`;
  const since_ = lastDeload ? `since the last deload (${lastDeload})` : 'since the plan started';
  if (since >= hi) return { lastDeload, weeksSince: since, status: 'overdue', text: `${since} weeks ${since_}; the plan calls for one every ${lo}–${hi}. Cut sets by ${reduce} for a week.` };
  if (since >= lo) return { lastDeload, weeksSince: since, status: 'due', text: `${since} weeks ${since_}: a deload is due (cut sets by ${reduce} for a week), sooner if recovery slips.` };
  return { lastDeload, weeksSince: since, status: 'ok', text: `${since} week${since === 1 ? '' : 's'} ${since_}; next due in ${lo - since}–${hi - since} weeks.` };
}
