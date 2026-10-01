// ── Maintain model: keep performance inside a range ─────
//
// For mobility, skills and maintenance lifting: there is no next stage to earn.
// Green while recent sessions stay inside the prescription; yellow when they
// fall below it; red when they fall below it twice in a row.

import { doseText } from '../format';
import { judge } from './variation';
import { effortText, headlineOf, loadSuffix, mergeRows, quantityFor, targetRange, valuesText } from './shared';
import { DELOAD_SIGNAL, easedIn, rpeCeiling, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

export const maintainModel: ProgressionModel = {
  id: 'maintain',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const target = ctx.stage.prescription ?? ctx.stage.advanceWhen;
    const q = quantityFor(target, ctx.records);
    const range = targetRange(target, q);
    const judged = ctx.records.map(r => judge(r, target, q, rpeCeiling(target, ctx.rules)));
    const inRange = (j: (typeof judged)[number]) => !range || j.inRange;
    // Deload sessions keep their row but are not judged.
    const eased = easedIn(ctx);
    const active = judged.filter(j => !eased(j.record));

    const rows: ProgressRow[] = judged.map(j => ({
      dates: [j.record.date],
      sessionIds: [j.record.sessionId],
      stageId: ctx.stage.id,
      work: `${ctx.stage.name} ${valuesText(j.values, q, ctx.system)}${loadSuffix(j.record, ctx.system)}`,
      headline: headlineOf(j.values, q, ctx.system),
      effort: effortText(j.record),
      signal: eased(j.record) ? DELOAD_SIGNAL : inRange(j) ? 'In range' : 'Below range',
    }));

    const targetText = doseText(target, ctx.system);
    const last = active[active.length - 1];
    if (!last) {
      return { rows, light: 'none', reasons: ['No sessions logged yet.'], readiness: null, nextAction: `Keep ${ctx.stage.name.toLowerCase()} at ${targetText || 'a comfortable level'}.`, target, facts: { stage: ctx.stage.name, target: targetText } };
    }
    const lastTwoBelow = active.length >= 2 && active.slice(-2).every(j => !inRange(j));
    const light: ModelEvaluation['light'] = lastTwoBelow ? 'red' : inRange(last) ? 'green' : 'yellow';
    return {
      rows: mergeRows(rows),
      light,
      reasons: [lastTwoBelow ? 'Below the range in the last two sessions.' : inRange(last) ? 'The latest session is inside the range.' : 'The latest session fell below the range.'],
      readiness: null,
      nextAction: inRange(last) ? `Keep ${ctx.stage.name.toLowerCase()} at ${targetText}.` : `Bring ${ctx.stage.name.toLowerCase()} back to ${targetText}.`,
      target,
      facts: { stage: ctx.stage.name, target: targetText, lastWork: valuesText(last.values, q, ctx.system) },
    };
  },
};
