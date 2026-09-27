// ── Load model: same exercise, more weight ──────────────
//
// Linear / double progression by weight. A session QUALIFIES when, at its top
// working weight, the prescribed number of sets reached the top of the rep range
// with the effort inside the target. Enough qualifying sessions → add the
// increment. Two sessions in a row that miss the bottom of the range at the same
// weight → back the weight off by `regressPct`.

import { numberParam } from '../model-params';
import { doseText, rangeText, weightText } from '../format';
import type { PerformanceRecord } from '../records';
import { effortText, mergeRows, readinessLabel, rpesOf, trendSignal } from './shared';
import { qualifyingRange, rpeCeiling, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

interface LoadJudgement {
  record: PerformanceRecord;
  weight: number;
  repsAtWeight: number[];
  qualifies: boolean;
  missed: boolean;
  effortHigh: boolean;
  e1rm: number | null;
}

function round(kg: number, step: number): number {
  return Math.round(kg / step) * step;
}

export const loadModel: ProgressionModel = {
  id: 'load',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const target = ctx.stage.prescription ?? ctx.stage.advanceWhen;
    const reps = target?.reps;
    const minSets = target?.sets?.[0] ?? 1;
    const ceiling = rpeCeiling(target, ctx.rules);
    const increment = numberParam(ctx.path.params, 'incrementKg', 2.5);
    const regressPct = numberParam(ctx.path.params, 'regressPct', 10);
    const qualifying = qualifyingRange(ctx.stage, ctx.rules);

    const judged: LoadJudgement[] = ctx.records.map(record => {
      const weights = record.sets.map(s => s.weightKg ?? 0);
      const weight = Math.max(0, ...weights);
      const atWeight = record.sets.filter(s => (s.weightKg ?? 0) === weight);
      const repsAtWeight = atWeight.map(s => s.reps ?? 0);
      const enough = repsAtWeight.length >= minSets;
      const top = reps ? reps[1] : Math.max(...repsAtWeight);
      const bottom = reps ? reps[0] : 1;
      const effortHigh = ceiling !== null && rpesOf(record).some(r => r > ceiling);
      const made = enough && repsAtWeight.slice(0, minSets).every(r => r >= top);
      return {
        record,
        weight,
        repsAtWeight,
        qualifies: made && !effortHigh,
        missed: !enough || repsAtWeight.slice(0, minSets).some(r => r < bottom),
        effortHigh,
        e1rm: record.totals.e1rmKg,
      };
    });

    let best = 0;
    const rows: ProgressRow[] = judged.map((j, i) => {
      const e = j.e1rm ?? 0;
      let signal: string;
      if (i === 0) signal = 'First logged session';
      else if (j.weight > judged[i - 1].weight) signal = `Weight up to ${weightText(j.weight, ctx.system)}`;
      else if (j.qualifies) signal = 'All sets at the top of the range';
      else if (j.missed) signal = 'Missed reps';
      else signal = trendSignal(e, judged[i - 1].e1rm, best);
      best = Math.max(best, e);
      const setsText = j.repsAtWeight.every(r => r === j.repsAtWeight[0])
        ? `${j.repsAtWeight.length}×${j.repsAtWeight[0]}`
        : j.repsAtWeight.join('/');
      return {
        dates: [j.record.date],
        sessionIds: [j.record.sessionId],
        stageId: ctx.stage.id,
        work: `${ctx.stage.name} ${setsText} @ ${weightText(j.weight, ctx.system)}`,
        headline: j.e1rm ? `e1RM ${weightText(j.e1rm, ctx.system)}` : `${j.record.totals.reps} reps`,
        effort: effortText(j.record),
        signal,
        ...(j.record.notes ? { notes: j.record.notes } : {}),
      };
    });

    const last = judged[judged.length - 1];
    // Qualifying sessions count only at the current working weight.
    const atCurrent = last ? judged.filter(j => j.weight === last.weight) : [];
    const q = atCurrent.slice(-qualifying[1]).filter(j => j.qualifies).length;
    const readiness = { qualifying: q, needed: qualifying[0], met: q >= qualifying[0], label: readinessLabel(q, qualifying, 'sessions'), unit: 'sessions' as const };
    const facts: ModelEvaluation['facts'] = { stage: ctx.stage.name, target: doseText(target, ctx.system) };

    if (!last) {
      return {
        rows, light: 'none', reasons: [`No ${ctx.stage.name.toLowerCase()} sessions logged yet.`], readiness,
        nextAction: `Find a starting weight you can lift for ${doseText(target, ctx.system) || 'the prescribed sets'} with a couple of reps to spare.`,
        target, facts,
      };
    }
    facts.lastWeight = weightText(last.weight, ctx.system);
    if (last.e1rm) facts.e1rm = weightText(last.e1rm, ctx.system);

    const lastTwoMissed = atCurrent.length >= 2 && atCurrent.slice(-2).every(j => j.missed);
    const setsReps = `${target?.sets ? target.sets[0] : last.repsAtWeight.length}×${reps ? rangeText(reps) : last.repsAtWeight[0]}`;
    let light: ModelEvaluation['light'];
    let nextAction: string;
    const reasons: string[] = [];
    if (lastTwoMissed) {
      const back = round(last.weight * (1 - regressPct / 100), increment);
      light = 'red';
      reasons.push(`Missed the bottom of the rep range twice at ${facts.lastWeight}.`);
      nextAction = `Back off ${regressPct}% to ${weightText(back, ctx.system)} for ${setsReps} and build up again.`;
    } else if (readiness.met) {
      light = 'green';
      reasons.push(`Every working set reached the top of the range at ${facts.lastWeight} with effort inside the target.`);
      nextAction = `Add ${weightText(increment, ctx.system)}: next session ${weightText(last.weight + increment, ctx.system)} for ${setsReps}.`;
    } else if (!last.missed && last.effortHigh && last.repsAtWeight.slice(0, target?.sets?.[0] ?? 1).every(r => r >= (reps?.[1] ?? 0))) {
      light = 'yellow-green';
      reasons.push(`Reps were made at ${facts.lastWeight}, but effort (${effortText(last.record)}) was above the RPE ${ceiling} ceiling.`);
      nextAction = `Repeat ${weightText(last.weight, ctx.system)} for ${setsReps} until it moves faster, then add weight.`;
    } else if (last.missed) {
      light = 'yellow';
      reasons.push(`Missed reps at ${facts.lastWeight}.`);
      nextAction = `Repeat ${weightText(last.weight, ctx.system)} for ${setsReps}; a second miss means backing off.`;
    } else {
      light = 'yellow';
      reasons.push(`Building reps at ${facts.lastWeight}.`);
      nextAction = `Stay at ${weightText(last.weight, ctx.system)} and build to ${setsReps} across every set.`;
    }
    return { rows: mergeRows(rows), light, reasons, readiness, nextAction, target, facts };
  },
};
