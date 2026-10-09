// ── body.goal and body.nutrition_adherence (SERVER ONLY) ─────────────────────
//
// The goal as the Body page reads it, and each logged day of food against the
// goal's targets as the Nutrition page judges it. Both are computed from the
// installed dataset, so they cannot disagree with the pages.

import { seriesFor } from '../../../adapters/dataset';
import { addDays } from '../../../analytics/windows';
import { adherenceBetween, calorieVerdict, proteinVerdict, type AdherenceDay } from '../../../body-goal/intake';
import { TREND_DAYS } from '../../../body-goal/constants';
import type { NutritionTargets } from '../../../body-goal/targets';
import { manifestEntry } from '../manifest';
import { ok, pageRows, sourceUnavailable } from '../envelope';
import type { CapabilityContext, Coverage } from '../types';
import { asWindow, emptyWindow, guarded, pagingOf, problemsOf, spanOf, windowOf, type Args, type Read } from './common';
import { clean, nothing, NO_DATABASE } from './app-common';
import { grams, kcal, range } from './app-format';
import { goalForModel } from './app-goal-view';
import { readersOf } from './app-readers';
import { plural } from './medications-select';

const NO_GOAL = 'No body goal is set.';
const MAX_CHARS = 9_500;
/** The page's four weeks end yesterday; today, the 29th day back, is cut off below. */
export const ADHERENCE_DEFAULT_DAYS = TREND_DAYS + 1;
export const ADHERENCE_LIMITS = { defaultLimit: 31, maxLimit: 60 } as const;

export function readBodyGoal(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('body.goal');
  return guarded(entry, ctx, async () => {
    const readers = readersOf(ctx);
    if (!readers.databaseConfigured(ctx.env)) return sourceUnavailable(entry, `${NO_DATABASE} The goal is stored there.`);
    const summary = await readers.goalSummary(ctx.system, ctx.env);
    return summary ? ok(entry, goalForModel(summary)) : nothing(entry, NO_GOAL);
  });
}

/** The days food was logged: the span the Nutrition page can speak about. */
export async function foodLogCoverage(ctx: CapabilityContext): Promise<Coverage> {
  if (!readersOf(ctx).databaseConfigured(ctx.env)) return { kind: 'unavailable', reason: NO_DATABASE };
  return spanOf(seriesFor('dietary_energy').map(p => p.key), 'logged days');
}

const CALORIES = { met: 'on target', ok: 'OK, close to the target', above: 'above the OK range', below: 'below the OK range' } as const;
const protein = (t: NutritionTargets) => ({ met: `on target (${t.proteinFloor} g or more)`, ok: 'OK, close to the floor', below: `under ${t.proteinOkFloor} g` }) as const;

function dayRow(d: AdherenceDay, t: NutritionTargets) {
  const counted = d.log === 'complete';
  const calOk = t.caloriesOk ?? t.calories;
  const pv = d.protein !== null && counted ? proteinVerdict(d.protein, t) : null;
  return clean({
    day: d.key,
    log: d.log,
    calories: d.kcal === null ? undefined : kcal(d.kcal),
    caloriesVerdict: counted && d.kcal !== null && t.calories && calOk ? CALORIES[calorieVerdict(d.kcal, t.calories, calOk)] : undefined,
    protein: d.protein === null ? undefined : grams(d.protein),
    proteinVerdict: pv === null ? undefined : protein(t)[pv],
  });
}

export function readNutritionAdherence(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('body.nutrition_adherence');
  return guarded(entry, ctx, async () => {
    const w = windowOf(args, ctx, ADHERENCE_DEFAULT_DAYS);
    if (!w.ok) return problemsOf(entry, w.problems);
    const paged = pagingOf(args, ADHERENCE_LIMITS.defaultLimit, ADHERENCE_LIMITS.maxLimit);
    if (!paged.ok) return problemsOf(entry, paged.problems);
    const readers = readersOf(ctx);
    if (!readers.databaseConfigured(ctx.env)) return sourceUnavailable(entry, `${NO_DATABASE} The goal is stored there.`);

    const report = await readers.goalReport(ctx.system, ctx.env);
    if (!report) return nothing(entry, NO_GOAL);
    const targets = report.targets;
    if (!targets) return nothing(entry, 'The body goal has no nutrition targets yet: they need a recent weight and a maintenance estimate.');

    // Today is still being logged: the page counts finished days, and so does this.
    const yesterday = addDays(ctx.refKey, -1);
    const window = { ...w.window, end: w.window.end < yesterday ? w.window.end : yesterday };
    const cut = w.window.end > yesterday ? 'Today is still being logged, so the window ends yesterday and counts finished days only.' : undefined;
    const echoed = asWindow({ ...window, ...(cut || w.window.clipped ? { clipped: [w.window.clipped, cut].filter(Boolean).join(' ') } : {}) });
    const coverage = await foodLogCoverage(ctx);
    if (window.start > window.end) return emptyWindow(entry, { ...window, end: window.start }, coverage);

    const adh = adherenceBetween(seriesFor, window.start, window.end, targets);
    const logged = adh.days.filter(d => d.log !== 'none');
    if (logged.length === 0) return emptyWindow(entry, window, coverage);

    const { rows, page } = pageRows([...logged].reverse(), { ...paged.paging, maxChars: MAX_CHARS, render: d => dayRow(d, targets) });
    const calOk = targets.caloriesOk ?? targets.calories;
    const days = plural(adh.completeDays, 'complete logged day');
    const summary = clean({
      days: `${days}${adh.partialDays ? `, ${plural(adh.partialDays, 'partly logged day')} left out of the counts` : ''}; days without a log are not counted`,
      calories: targets.calories && adh.caloriesInRange !== null
        ? `${(adh.caloriesInRange ?? 0) + (adh.caloriesOk ?? 0)} of ${adh.completeDays} logged days within the OK range, ${adh.caloriesInRange} on target, ${adh.caloriesAbove ?? 0} above and ${adh.caloriesBelow ?? 0} below it; average ${adh.averages.kcal === null ? 'not available' : kcal(adh.averages.kcal)}`
        : undefined,
      protein: adh.proteinDays > 0
        ? `${adh.proteinAtFloor + adh.proteinOk} of ${adh.proteinDays} logged days at ${targets.proteinOkFloor} g or more, ${adh.proteinAtFloor} on target; average ${adh.averages.protein === null ? 'not available' : grams(adh.averages.protein)}`
        : undefined,
    });
    const data = {
      targets: clean({
        calories: targets.calories ? `${range(targets.calories.min, targets.calories.max, 'kcal')} a day` : undefined,
        caloriesOk: calOk ? range(calOk.min, calOk.max, 'kcal') : undefined,
        protein: `${range(targets.protein.min, targets.protein.max, 'g')} a day`,
        proteinOkFrom: grams(targets.proteinOkFloor),
      }),
      summary,
      days: rows,
    };
    return ok(entry, data, { window: echoed, coverage, page });
  });
}
