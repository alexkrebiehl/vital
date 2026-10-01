// ── Percentage model: periodized work from a one-rep max ──
//
// The prescription comes from the block running now (its target for this path)
// or the stage, as sets × reps at a percent of the one-rep max. The max is the
// path's `oneRepMaxKg` param or, when absent, the best estimated max (Epley)
// over the stage's recent sessions. A session is ON TARGET when the prescribed
// sets were completed at a weight inside the prescribed band.

import { numberParam } from '../model-params';
import { doseText, weightRangeText, weightText } from '../format';
import type { Dose } from '../types';
import { effortText, mergeRows, readinessLabel } from './shared';
import { DELOAD_SIGNAL, easedIn, qualifyingRange, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

const ROUND_KG = 2.5;

export function prescriptionFor(ctx: EvaluationContext): Dose | undefined {
  for (const block of ctx.blocks) {
    const t = block.targets.find(x => x.pathId === ctx.path.id && x.dose?.load?.pct1rm);
    if (t?.dose) return t.dose;
  }
  return ctx.stage.prescription ?? ctx.stage.advanceWhen;
}

export const percentageModel: ProgressionModel = {
  id: 'percentage',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const dose = prescriptionFor(ctx);
    const pct = dose?.load?.pct1rm;
    const reps = dose?.reps;
    const sets = dose?.sets?.[0] ?? 1;
    const recent = ctx.records.slice(-12);
    const estimated = Math.max(0, ...recent.map(r => r.totals.e1rmKg ?? 0));
    const oneRm = numberParam(ctx.path.params, 'oneRepMaxKg', estimated);
    const band = pct && oneRm > 0
      ? ([Math.round((oneRm * pct[0]) / 100 / ROUND_KG) * ROUND_KG, Math.round((oneRm * pct[1]) / 100 / ROUND_KG) * ROUND_KG] as [number, number])
      : null;
    const qualifying = qualifyingRange(ctx.stage, ctx.rules);

    const judged = ctx.records.map(record => {
      const weight = Math.max(0, ...record.sets.map(s => s.weightKg ?? 0));
      const done = record.sets.filter(s => (s.weightKg ?? 0) >= (band ? band[0] : weight) && (s.reps ?? 0) >= (reps?.[0] ?? 1));
      const onTarget = done.length >= sets && (!band || weight <= band[1] + ROUND_KG);
      const under = band !== null && weight < band[0];
      return { record, weight, onTarget, under };
    });

    // Deload sessions keep their row but are not judged.
    const eased = easedIn(ctx);
    const active = judged.filter(j => !eased(j.record));
    const rows: ProgressRow[] = judged.map(j => ({
      dates: [j.record.date],
      sessionIds: [j.record.sessionId],
      stageId: ctx.stage.id,
      work: `${ctx.stage.name} ${j.record.sets.map(s => s.reps ?? 0).join('/')} @ ${weightText(j.weight, ctx.system)}`,
      headline: j.record.totals.e1rmKg ? `e1RM ${weightText(j.record.totals.e1rmKg, ctx.system)}` : `${j.record.totals.reps} reps`,
      effort: effortText(j.record),
      signal: eased(j.record) ? DELOAD_SIGNAL : j.onTarget ? 'On target' : j.under ? 'Under the prescribed load' : 'Missed prescribed sets',
    }));

    const q = active.slice(-qualifying[1]).filter(j => j.onTarget).length;
    // Periodized work has no build-up toward a marker: only sessions on target count.
    const readiness = { qualifying: q, needed: qualifying[0], met: q >= qualifying[0], progress: Math.min(1, q / Math.max(1, qualifying[0])), label: readinessLabel(q, qualifying, 'sessions'), unit: 'sessions' as const };
    const prescription = `${doseText(dose, ctx.system)}${band ? ` (≈ ${weightRangeText(band, ctx.system)})` : ''}`;
    const facts: ModelEvaluation['facts'] = { stage: ctx.stage.name, prescription };
    if (oneRm > 0) facts.oneRepMax = weightText(oneRm, ctx.system);
    const last = active[active.length - 1];
    if (!last) {
      return { rows, light: 'none', reasons: ['No sessions logged in this stage yet.'], readiness, nextAction: `Next: ${prescription}.`, target: dose, facts };
    }
    const missedTwice = active.length >= 2 && active.slice(-2).every(j => !j.onTarget && !j.under);
    const light: ModelEvaluation['light'] = missedTwice ? 'red' : readiness.met ? 'green' : last.onTarget ? 'yellow-green' : 'yellow';
    const reasons = [
      missedTwice
        ? 'The prescribed sets were missed in the last two sessions.'
        : last.onTarget
          ? `The last session was on target (${rows[judged.indexOf(last)].work}).`
          : last.under
            ? 'The last session was lighter than prescribed.'
            : 'The last session missed prescribed sets.',
    ];
    if (!pct) reasons.push('This stage has no %1RM prescription; add one to the block or the stage.');
    const nextAction = missedTwice
      ? `Re-test or lower the working max: the prescription (${prescription}) is currently too heavy.`
      : `Next: ${prescription}.`;
    return { rows: mergeRows(rows), light, reasons, readiness, nextAction, target: dose, facts };
  },
};
