// ── Variation model: double progression, then a harder variation ──
//
// The stage's marker is a set count and a range (reps, hold time, distance).
// Build within the range until the working sets sit at the top of it, with the
// effort still inside the target, for enough sessions — then move to the next
// variation and build back up from the bottom of its range.
//
// A session QUALIFIES when it has at least the minimum number of working sets,
// every one of them reaches the bottom of the range, their total is within one
// "step" of every set at the top (so 12/12/10 counts for 8–12, 12/11/9 does not),
// and no set went past the effort ceiling.
//
// This covers bodyweight skill paths, holds, negatives, per-side work, a long
// run that grows by distance, and assisted work (where less assistance is the
// progress — see the load suffix and the "Reduce assistance" advice).

import { doseText, rangeText, weightText } from '../format';
import type { PerformanceRecord } from '../records';
import type { Dose } from '../types';
import {
  effortText,
  fallingStreak,
  headlineOf,
  loadSuffix,
  mergeRows,
  quantityFor,
  readinessLabel,
  rpesOf,
  sumOf,
  targetRange,
  trendSignal,
  valuesOf,
  valuesText,
  type Quantity,
} from './shared';
import { qualifyingRange, rpeCeiling, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

interface SessionJudgement {
  record: PerformanceRecord;
  values: number[];
  total: number;
  inRange: boolean;
  nearTop: boolean;
  effortHigh: boolean;
  qualifies: boolean;
}

function slack(range: [number, number]): number {
  return Math.max(1, Math.round((range[1] - range[0]) * 0.2));
}

export function judge(record: PerformanceRecord, target: Dose | undefined, q: Quantity, ceiling: number | null): SessionJudgement {
  const values = valuesOf(record, q);
  const total = sumOf(values);
  const range = targetRange(target, q);
  const minSets = target?.sets?.[0] ?? 1;
  const counted = values.slice(0, Math.max(minSets, 1));
  const enoughSets = values.length >= minSets;
  const inRange = Boolean(range) && enoughSets && counted.every(v => v >= range![0]);
  const nearTop = Boolean(range) && inRange && sumOf(counted) >= counted.length * (range![1] - slack(range!));
  const rpes = rpesOf(record);
  const effortHigh = ceiling !== null && rpes.some(r => r > ceiling);
  return { record, values, total, inRange, nearTop, effortHigh, qualifies: nearTop && !effortHigh };
}

function rowFor(
  j: SessionJudgement,
  stageName: string,
  stageId: string,
  q: Quantity,
  ctx: EvaluationContext
): ProgressRow {
  return {
    dates: [j.record.date],
    sessionIds: [j.record.sessionId],
    stageId,
    work: `${stageName} ${valuesText(j.values, q, ctx.system)}${loadSuffix(j.record, ctx.system)}`,
    headline: headlineOf(j.values, q, ctx.system),
    effort: effortText(j.record),
    signal: '',
    ...(j.record.notes ? { notes: j.record.notes } : {}),
  };
}

/** The dose the current stage (or step) is measured against. */
export function stageTarget(ctx: EvaluationContext): Dose | undefined {
  const step = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex] : undefined;
  return step?.advanceWhen ?? ctx.stage.advanceWhen ?? ctx.stage.prescription;
}

export const variationModel: ProgressionModel = {
  id: 'variation',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const target = stageTarget(ctx);
    const ceiling = rpeCeiling(target, ctx.rules);
    const q = quantityFor(target, ctx.records);
    const range = targetRange(target, q);
    const qualifying = qualifyingRange(ctx.stage, ctx.rules);
    const judged = ctx.records.map(r => judge(r, target, q, ceiling));

    // ── Rows: the previous stage's last sessions, then this stage ──
    const rows: (ProgressRow & { keep?: boolean })[] = [];
    if (ctx.previousStage && ctx.previousRecords.length) {
      const prevTarget = ctx.previousStage.advanceWhen ?? ctx.previousStage.prescription;
      const prevQ = quantityFor(prevTarget, ctx.previousRecords);
      const prev = ctx.previousRecords.map(r => judge(r, prevTarget, prevQ, rpeCeiling(prevTarget, ctx.rules)));
      let best = 0;
      prev.forEach((j, i) => {
        const signal = i === prev.length - 1 ? `Final ${ctx.previousStage!.name.toLowerCase()} session before progression` : trendSignal(j.total, i ? prev[i - 1].total : null, best);
        best = Math.max(best, j.total);
        if (i >= prev.length - 3) {
          rows.push({ ...rowFor(j, ctx.previousStage!.name, ctx.previousStage!.id, prevQ, ctx), signal, keep: i === prev.length - 1 });
        }
      });
    }
    let best = 0;
    judged.forEach((j, i) => {
      let signal: string;
      const prevLoad = i > 0 ? judged[i - 1].record.totals.topWeightKg : null;
      const load = j.record.totals.topWeightKg;
      const lessHelp = j.record.loadMeaning === 'assistance' && prevLoad !== null && load !== null && load < prevLoad && j.total >= judged[i - 1].total;
      const moreLoad = j.record.loadMeaning === 'added' && prevLoad !== null && load !== null && load > prevLoad && j.total >= judged[i - 1].total;
      if (i === 0) signal = j.inRange && !j.effortHigh ? `Clean ${ctx.stage.name.toLowerCase()} entry` : `${ctx.stage.name} entry`;
      else if (j.qualifies) signal = 'Meets the progression marker';
      else if (j.nearTop && j.effortHigh) signal = 'Near top of range, effort high';
      else if (lessHelp) signal = 'Same reps with less assistance';
      else if (moreLoad) signal = 'Same reps with more load';
      else signal = trendSignal(j.total, judged[i - 1].total, best);
      best = Math.max(best, j.total);
      rows.push({ ...rowFor(j, ctx.stage.name, ctx.stage.id, q, ctx), signal });
    });

    const last = judged[judged.length - 1];
    const recent = judged.slice(-qualifying[1]);
    const q2 = recent.filter(j => j.qualifies).length;
    const readiness = {
      qualifying: q2,
      needed: qualifying[0],
      met: q2 >= qualifying[0],
      label: readinessLabel(q2, qualifying, 'sessions'),
      unit: 'sessions' as const,
    };

    const targetText = doseText(target, ctx.system);
    const facts: ModelEvaluation['facts'] = { stage: ctx.stage.name, target: targetText, qualifying: q2, needed: qualifying[0] };
    if (!last) {
      return {
        rows: mergeRows(rows),
        light: 'none',
        reasons: [`No ${ctx.stage.name.toLowerCase()} sessions logged yet.`],
        readiness,
        nextAction: `Start ${ctx.stage.name.toLowerCase()} at ${doseText(ctx.stage.prescription ?? target, ctx.system) || 'an easy, controlled volume'}.`,
        target,
        facts,
      };
    }
    facts.lastWork = valuesText(last.values, q, ctx.system);
    facts.lastTotal = last.total;
    const lastEffort = effortText(last.record);
    if (lastEffort) facts.lastEffort = lastEffort;

    const reasons: string[] = [];
    const sets = target?.sets ? rangeText([target.sets[0], target.sets[0]]) : String(last.values.length);
    const topBand = range ? `${rangeText([Math.max(range[0], range[1] - Math.max(1, Math.round((range[1] - range[0]) / 2))), range[1]])}${q === 'durationS' ? ' s' : ''}` : '';
    const qualText = rangeText(qualifying);
    const step = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex] : undefined;
    const nextStep = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex + 1] : undefined;

    let light: ModelEvaluation['light'];
    let nextAction: string;
    if (fallingStreak(judged.map(j => j.total))) {
      light = 'red';
      reasons.push('Performance fell in each of the last two sessions.');
      nextAction = `Hold ${ctx.stage.name.toLowerCase()} and drop a set until the numbers recover; check sleep, soreness and joints before pushing again.`;
    } else if (readiness.met) {
      light = 'green';
      reasons.push(`The marker (${targetText}) was met in ${q2} of the last ${recent.length} sessions with effort inside the target.`);
      if (nextStep) nextAction = `Move on to ${nextStep.name.toLowerCase()} within ${ctx.stage.name.toLowerCase()}.`;
      else if (ctx.nextStage) nextAction = `Move to ${ctx.nextStage.name.toLowerCase()}: start at ${doseText(ctx.nextStage.prescription ?? ctx.nextStage.advanceWhen, ctx.system) || 'the bottom of its range'} and build back up.`;
      else nextAction = `This is the last stage of the path: keep ${ctx.stage.name.toLowerCase()} at ${targetText}, or add a harder stage.`;
    } else if (last.nearTop && last.effortHigh) {
      light = 'yellow-green';
      reasons.push(`The latest work (${facts.lastWork}) meets the ${range ? rangeText(range) : ''} range, but effort reached ${lastEffort}, above the RPE ${ceiling} ceiling.`);
      nextAction = `Repeat ${sets}×${topBand} with consistent form and lower perceived effort for ${qualText} sessions. Do not move on while sets are near failure.`;
    } else if (q2 > 0) {
      light = 'yellow-green';
      reasons.push(`${readiness.label}; one more at the marker earns the next ${step ? 'step' : 'stage'}.`);
      nextAction = `Repeat ${targetText} for ${qualifying[0] - q2} more session${qualifying[0] - q2 === 1 ? '' : 's'}.`;
    } else {
      light = 'yellow';
      reasons.push(last.inRange ? `In range (${facts.lastWork}) but not yet at the top of it.` : `Still building toward ${targetText}.`);
      nextAction = range
        ? `Keep adding ${q === 'reps' ? 'reps' : q === 'durationS' ? 'time' : 'distance'} toward ${sets}×${rangeText([range[1], range[1]])}${q === 'durationS' ? ' s' : ''} (last: ${facts.lastWork}).`
        : `Keep building ${ctx.stage.name.toLowerCase()} (last: ${facts.lastWork}).`;
      if (last.record.loadMeaning === 'assistance' && last.record.totals.topWeightKg) {
        nextAction += ` Once every set reaches the top, reduce the assistance (now ${weightText(last.record.totals.topWeightKg, ctx.system)}) and build back up.`;
      }
      if (last.effortHigh) reasons.push(`Effort reached ${lastEffort}, above the RPE ${ceiling} ceiling.`);
    }
    if (last.record.loadMeaning === 'assistance' && light === 'green' && !ctx.nextStage) {
      nextAction = 'Reduce the assistance and build the reps back up.';
    }

    return { rows: mergeRows(rows), light, reasons, readiness, nextAction, target, facts };
  },
};
