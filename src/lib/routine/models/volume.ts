// ── Volume model: build weekly volume safely ────────────
//
// For endurance (weekly distance or time) and hypertrophy (weekly hard sets).
// Sessions are summed into Monday-start weeks. A complete week QUALIFIES when it
// lands inside the stage's marker; the light also watches the ramp — a week more
// than `maxWeeklyIncreasePct` above the one before is flagged, and two falling
// weeks outside a deload or taper block turn it red.

import { numberParam } from '../model-params';
import { distanceText, doseText, durationText, paceText } from '../format';
import type { PerformanceRecord } from '../records';
import { addDays, dayKeyToDate, formatDayKeyShort } from '../../analytics/windows';
import { readinessLabel, readinessProgress } from './shared';
import { qualifyingRange, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

type VolumeMetric = 'distanceM' | 'durationS' | 'sets';

export function weekStart(key: string): string {
  const dow = (dayKeyToDate(key).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

function amount(record: PerformanceRecord, metric: VolumeMetric): number {
  if (metric === 'sets') return record.sets.length;
  return metric === 'distanceM' ? record.totals.distanceM : record.totals.durationS;
}

export function volumeText(value: number, metric: VolumeMetric, ctx: EvaluationContext): string {
  if (metric === 'distanceM') return distanceText(value, ctx.system);
  if (metric === 'durationS') return durationText(value);
  return `${value} sets`;
}

interface Week {
  start: string;
  total: number;
  sessions: PerformanceRecord[];
  complete: boolean;
}

export const volumeModel: ProgressionModel = {
  id: 'volume',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const dose = ctx.stage.prescription;
    const marker = ctx.stage.advanceWhen?.weeklyVolume ?? dose?.weeklyVolume;
    const metric = (ctx.path.params?.metric as VolumeMetric | undefined) ?? marker?.metric ?? 'distanceM';
    const maxRamp = numberParam(ctx.path.params, 'maxWeeklyIncreasePct', 10);
    const qualifying = qualifyingRange(ctx.stage, ctx.rules);
    const thisWeek = weekStart(ctx.today);

    const byWeek = new Map<string, Week>();
    for (const r of ctx.records) {
      const start = weekStart(r.date);
      const w = byWeek.get(start) ?? { start, total: 0, sessions: [], complete: start < thisWeek };
      w.total += amount(r, metric);
      w.sessions.push(r);
      byWeek.set(start, w);
    }
    // Weeks with no sessions still count (a zero week is real information).
    const weeks: Week[] = [];
    const first = ctx.records[0] ? weekStart(ctx.records[0].date) : thisWeek;
    for (let s = first; s <= thisWeek; s = addDays(s, 7)) {
      weeks.push(byWeek.get(s) ?? { start: s, total: 0, sessions: [], complete: s < thisWeek });
    }

    const rows: ProgressRow[] = weeks.slice(-8).map((w, i, shown) => {
      const prev = i > 0 ? shown[i - 1] : weeks[weeks.length - shown.length - 1];
      const change = prev && prev.total > 0 ? ((w.total - prev.total) / prev.total) * 100 : null;
      const distance = w.sessions.reduce((a, r) => a + r.totals.distanceM, 0);
      const time = w.sessions.reduce((a, r) => a + r.totals.durationS, 0);
      let signal = !w.complete ? 'Week in progress' : change === null ? 'First week' : change > maxRamp ? `Up ${Math.round(change)}% — above the ${maxRamp}% ramp` : change >= 0 ? `Up ${Math.round(change)}%` : `Down ${Math.round(-change)}%`;
      if (w.complete && marker && w.total >= marker.range[0] && w.total <= marker.range[1] * 1.1) signal = `${signal}; on target`;
      return {
        dates: [w.start],
        sessionIds: w.sessions.map(r => r.sessionId),
        stageId: ctx.stage.id,
        work: `Week of ${formatDayKeyShort(w.start)}: ${volumeText(w.total, metric, ctx)}`,
        headline: `${w.sessions.length} session${w.sessions.length === 1 ? '' : 's'}${distance > 0 && time > 0 ? ` · ${paceText(time / (distance / 1000), ctx.system)}` : ''}`,
        effort: null,
        signal,
      };
    });

    const complete = weeks.filter(w => w.complete);
    const lastWeek = complete[complete.length - 1];
    const prevWeek = complete[complete.length - 2];
    const recent = complete.slice(-qualifying[1]);
    const q = marker ? recent.filter(w => w.total >= marker.range[0]).length : 0;
    const progress = marker && marker.range[0] > 0
      ? Math.max(0, ...recent.map(w => readinessProgress(w.total / marker.range[0], null, q, qualifying[0])))
      : 0;
    const readiness = { qualifying: q, needed: qualifying[0], met: q >= qualifying[0], progress, label: readinessLabel(q, qualifying, 'weeks'), unit: 'weeks' as const };
    const facts: ModelEvaluation['facts'] = { stage: ctx.stage.name, target: doseText(dose, ctx.system) };
    const current = weeks[weeks.length - 1];
    facts.thisWeek = volumeText(current.total, metric, ctx);

    if (!lastWeek || ctx.records.length === 0) {
      return {
        rows, light: 'none', reasons: ['No complete week of sessions yet.'], readiness,
        nextAction: marker ? `Build toward ${volumeText(marker.range[0], metric, ctx)} a week.` : 'Log a week of sessions to set a baseline.',
        target: dose, facts,
      };
    }
    facts.lastWeek = volumeText(lastWeek.total, metric, ctx);
    const ramp = prevWeek && prevWeek.total > 0 ? ((lastWeek.total - prevWeek.total) / prevWeek.total) * 100 : null;
    const easing = ctx.blocks.some(b => b.kind === 'deload' || b.kind === 'taper');
    const falling = complete.length >= 3 && complete.slice(-3).every((w, i, a) => i === 0 || w.total < a[i - 1].total * 0.9);
    const cap = lastWeek.total * (1 + maxRamp / 100);
    const nextTarget = marker ? Math.min(cap, marker.range[1]) : cap;

    const reasons: string[] = [];
    let light: ModelEvaluation['light'];
    let nextAction: string;
    if (falling && !easing) {
      light = 'red';
      reasons.push('Weekly volume fell two weeks running.');
      nextAction = `Rebuild gently: aim for about ${volumeText(lastWeek.total * 1.05, metric, ctx)} next week and check what is getting in the way.`;
    } else if (ramp !== null && ramp > maxRamp) {
      light = 'yellow';
      reasons.push(`Last week was ${Math.round(ramp)}% above the week before; the plan allows ${maxRamp}%.`);
      nextAction = `Hold at about ${volumeText(lastWeek.total, metric, ctx)} next week before building again.`;
    } else if (readiness.met) {
      light = 'green';
      reasons.push(`Weekly volume met the marker for ${q} week${q === 1 ? '' : 's'}.`);
      nextAction = ctx.nextStage
        ? `Move to ${ctx.nextStage.name.toLowerCase()}: ${doseText(ctx.nextStage.prescription, ctx.system)}.`
        : `Hold ${volumeText(lastWeek.total, metric, ctx)} a week.`;
    } else {
      light = q > 0 ? 'yellow-green' : 'yellow';
      reasons.push(marker ? `Building toward ${volumeText(marker.range[0], metric, ctx)} a week (last: ${facts.lastWeek}).` : `Last week: ${facts.lastWeek}.`);
      nextAction = `Aim for up to ${volumeText(nextTarget, metric, ctx)} next week — no more than ${maxRamp}% above last week.`;
    }
    if (easing) nextAction = `${ctx.blocks.find(b => b.kind === 'deload' || b.kind === 'taper')!.name}: keep volume down this week. ${nextAction}`;
    return { rows, light, reasons, readiness, nextAction, target: dose, facts };
  },
};
