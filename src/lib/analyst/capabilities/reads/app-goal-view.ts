// ── The body goal summary as display strings (SERVER ONLY) ───────────────────
//
// `BodyGoalSummary` is the compact report the briefing carries: plain numbers in the
// reader's units. A tool result may not hold a bare number, so each one becomes the
// text the Body page prints for it (value and unit), and a missing one is left out.

import type { BodyGoalSummary } from '../../../body-goal/summary';
import { plural } from './medications-select';
import { clean } from './app-common';
import { grams, kcal, percent, range, signed } from './app-format';

const orUndefined = <T, R>(v: T | null | undefined, f: (x: T) => R): R | undefined => (v === null || v === undefined ? undefined : f(v));

export function goalForModel(s: BodyGoalSummary) {
  const w = (v: number | null) => orUndefined(v, x => `${x} ${s.weightUnit}`);
  const sw = (v: number | null) => orUndefined(v, x => signed(x, s.weightUnit));
  const pc = (v: number | null, digits = 1) => orUndefined(v, x => percent(x, digits));
  const kc = (v: number | null) => orUndefined(v, kcal);
  const span = (v: [number, number] | null, unit: 'kcal' | 'g') => orUndefined(v, x => range(x[0], x[1], unit));
  const t = s.targets;
  return clean({
    goal: s.goal,
    setOn: s.setOn,
    phase: s.phase,
    phaseNote: s.phaseNote,
    current: clean({ weight: w(s.current.weight), bodyFat: pc(s.current.bodyFatPct), leanMass: w(s.current.leanMass) }),
    start: clean({ weight: w(s.start.weight), bodyFat: pc(s.start.bodyFatPct) }),
    progress: orUndefined(s.progressPct, x => percent(x)),
    trend: clean({
      perWeek: orUndefined(sw(s.trend.perWeek), x => `${x} a week`),
      pctBodyWeightPerWeek: orUndefined(s.trend.pctBodyWeightPerWeek, x => `${x > 0 ? '+' : ''}${x.toFixed(2)} % of body weight a week`),
      lastTwoWeeksPerWeek: orUndefined(sw(s.trend.lastTwoWeeksPerWeek), x => `${x} a week`),
      weighIns: plural(s.trend.weighIns, 'weigh-in'),
      comparedWithRecommended: s.trend.comparedWithRecommended,
    }),
    recommendedPace: orUndefined(s.recommendedPacePctPerWeek, x => `${x.min}\u2013${x.max} % of body weight a week`),
    paceInUse: orUndefined(s.paceInUse, p => clean({ perWeek: `${signed(p.perWeek, s.weightUnit)} a week`, pctBodyWeightPerWeek: `${p.pctBodyWeightPerWeek.toFixed(2)} % of body weight a week`, source: p.source })),
    goalWeight: w(s.goalWeight),
    arrivalAtPaceInUse: orUndefined(s.arrivalAtPaceInUse, a => `about ${a.weeks} weeks, around ${a.date} (a projection from the pace, not a deadline)`),
    trendNote: s.trendNote,
    maintenance: clean({ fromWeightTrend: kc(s.maintenanceKcal.fromWeightTrend), fromDevice: kc(s.maintenanceKcal.fromDevice), used: kc(s.maintenanceKcal.used), agreement: s.maintenanceKcal.agreement }),
    foodLog: clean({ loggedDays: plural(s.foodLog.loggedDays, 'logged day'), completeDays: plural(s.foodLog.completeDays, 'complete day'), note: s.foodLog.note }),
    intakePerDay: kc(s.intakeKcalPerDay),
    balancePerDay: orUndefined(s.balanceKcalPerDay, x => `${signed(Math.round(x), 'kcal')} a day`),
    balanceFromWeightTrendPerDay: orUndefined(s.balanceFromWeightTrendKcalPerDay, x => `${signed(Math.round(x), 'kcal')} a day`),
    targets: orUndefined(t, x =>
      clean({
        calories: span(x.kcal, 'kcal'),
        caloriesOk: span(x.kcalOk, 'kcal'),
        protein: range(x.proteinG[0], x.proteinG[1], 'g'),
        proteinOkFrom: grams(x.proteinOkMinG),
        fatFloor: grams(x.fatFloorG),
        carbs: span(x.carbsG, 'g'),
        fiber: span(x.fiberG, 'g'),
        checkIn: x.checkIn,
      })
    ),
    flags: s.flags.length ? s.flags : undefined,
    logConsistency: s.logConsistency,
  });
}
