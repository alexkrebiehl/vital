import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics/windows';
import {
  bodyFatLevel,
  bodyGoalReport,
  bodyGoalSummary,
  changeToTarget,
  effectivePace,
  energyBalance,
  goalPhase,
  macroConsistency,
  monthlyIntake,
  nutritionTargets,
  projectArrival,
  recommendedBand,
  splitLoggedDays,
  trendFit,
  validateBodyGoalInput,
  weightTrend,
  type BodyGoal,
  type DayValue,
} from './index';

// A cut shaped like the 2026-10-04 milestone: ~2 lb/week down to ~174.6 lb at
// 17.9 % body fat, ~2,066 kcal logged on complete days, three partial logs,
// 181 g protein, 163 g carbs, and a food whose fat is inflated by ~86 g on
// most days.
const TODAY = '2026-10-04';
const LB = 0.45359237;
const KG_PER_DAY = (-2 * LB) / 7;

function days(n: number, end = TODAY): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, -(n - 1 - i)));
}

function cutSeries(): Record<string, DayValue[]> {
  const keys = days(90);
  const weight = keys.map((key, i) => ({ key, value: 174.6 * LB + KG_PER_DAY * (i - 89) + (i % 3 === 0 ? 0.2 : -0.1) }));
  const bodyFat = keys.filter((_, i) => i % 2 === 0).map((key, i, arr) => ({ key, value: 20 - (2.1 * i) / (arr.length - 1) }));
  const logged = keys.slice(0, -1);
  const partial = new Set([logged[60], logged[70], logged[80]]);
  const energy = logged.map(key => ({ key, value: partial.has(key) ? 900 : 2066 }));
  const protein = logged.map(key => ({ key, value: partial.has(key) ? 80 : 181 }));
  const carbs = logged.map(key => ({ key, value: partial.has(key) ? 60 : 163 }));
  const realFat = (2066 - 4 * 181 - 4 * 163) / 9;
  const fat = logged.map((key, i) => ({ key, value: partial.has(key) ? 40 : realFat + (i % 5 < 3 ? 86 : 0) }));
  return {
    weight_body_mass: weight,
    body_fat_percentage: bodyFat,
    dietary_energy: energy,
    dietary_protein: protein,
    dietary_carbs: carbs,
    dietary_fat_total: fat,
    basal_energy_burned: logged.map(key => ({ key, value: 1969 })),
    active_energy: logged.map(key => ({ key, value: 885 })),
    step_count: logged.map(key => ({ key, value: 12000 })),
  };
}

const lookup = (data: Record<string, DayValue[]>) => (id: string) => data[id] ?? [];

function goal(partial: Partial<BodyGoal> = {}): BodyGoal {
  return {
    id: 'g1',
    kind: 'body_fat',
    target: 15,
    paceKgPerWeek: null,
    startedOn: addDays(TODAY, -21),
    endedOn: null,
    status: 'active',
    revision: 1,
    updatedAt: '2026-09-13T12:00:00.000Z',
    ...partial,
  };
}

describe('validateBodyGoalInput', () => {
  it('accepts a weight goal and a body-fat goal', () => {
    expect(validateBodyGoalInput({ kind: 'weight', target: 75, paceKgPerWeek: -0.5 })).toEqual({ ok: true, input: { kind: 'weight', target: 75, paceKgPerWeek: -0.5 } });
    expect(validateBodyGoalInput({ kind: 'body_fat', target: 15 })).toEqual({ ok: true, input: { kind: 'body_fat', target: 15, paceKgPerWeek: null } });
  });

  it('rejects unknown fields, bad kinds, implausible targets and paces', () => {
    const bad = (body: unknown) => {
      const v = validateBodyGoalInput(body);
      expect(v.ok).toBe(false);
      return v.ok ? [] : v.errors;
    };
    expect(bad({ kind: 'weight', target: 75, startWeight: 80 }).join(' ')).toMatch(/Unknown field/);
    expect(bad({ kind: 'muscle', target: 75 }).join(' ')).toMatch(/kind/);
    expect(bad({ kind: 'weight', target: 700 }).join(' ')).toMatch(/between 30 and 300 kg/);
    expect(bad({ kind: 'body_fat', target: 80 }).join(' ')).toMatch(/between 3 and 60 percent/);
    expect(bad({ kind: 'weight', target: 75, paceKgPerWeek: 5 }).join(' ')).toMatch(/±2 kg/);
    expect(bad([]).join(' ')).toMatch(/JSON object/);
  });
});

describe('weight trend', () => {
  it('measures the four-week rate and a seven-day current weight', () => {
    const t = weightTrend(cutSeries().weight_body_mass, TODAY);
    expect(t.rateKgPerWeek! / LB).toBeCloseTo(-2, 1);
    expect(t.current!.value / LB).toBeCloseTo(174.6 + 3 * (2 / 7), 0);
    expect(t.ratePct).toBeLessThan(-1);
    expect(t.weighIns).toBe(28);
  });

  it('has no rate with too few weigh-ins', () => {
    const t = weightTrend([{ key: TODAY, value: 80 }], TODAY);
    expect(t.rateKgPerWeek).toBeNull();
    expect(t.current!.value).toBe(80);
  });
});

describe('energy balance', () => {
  it('leaves partial logs out and estimates maintenance from the trend', () => {
    const e = energyBalance(lookup(cutSeries()), TODAY);
    expect(e.days.partial.map(d => d.value)).toEqual([900, 900, 900].slice(0, e.days.partial.length));
    expect(e.days.partial.length).toBeGreaterThan(0);
    expect(e.intake).toBeCloseTo(2066, 0);
    // 2,066 + 2 lb/week in energy ≈ 3,066 kcal/day.
    expect(e.adaptive!).toBeGreaterThan(3000);
    expect(e.adaptive!).toBeLessThan(3130);
    expect(e.device).toBe(2854);
    expect(e.maintenanceSource).toBe('weight-trend');
    expect(e.balance!).toBeLessThan(-900);
    expect(['agree', 'trend-higher']).toContain(e.agreement);
  });

  it('says why it cannot estimate maintenance without enough logs', () => {
    const data = cutSeries();
    data.dietary_energy = data.dietary_energy.slice(-5);
    const e = energyBalance(lookup(data), TODAY);
    expect(e.adaptive).toBeNull();
    expect(e.adaptiveReason).toMatch(/complete logged days/);
    expect(e.maintenanceSource).toBe('device');
  });

  it('flags source-marked and far-below-median days as partial', () => {
    const split = splitLoggedDays([
      { key: 'a', value: 2000 },
      { key: 'b', value: 2100 },
      { key: 'c', value: 900 },
      { key: 'd', value: 2050, partial: true } as DayValue,
    ]);
    expect(split.partial.map(d => d.key)).toEqual(['c', 'd']);
  });
});

describe('phase and pace', () => {
  it('reads cut, bulk and maintain from the data, not from the goal', () => {
    const weight = { value: 80, from: TODAY, to: TODAY, count: 7 };
    const bf = { value: 18, from: TODAY, to: TODAY, count: 3 };
    expect(goalPhase({ kind: 'weight', target: 75 }, weight, bf).phase).toBe('cut');
    expect(goalPhase({ kind: 'weight', target: 85 }, weight, bf).phase).toBe('bulk');
    expect(goalPhase({ kind: 'weight', target: 80.5 }, weight, bf).phase).toBe('maintain');
    expect(goalPhase({ kind: 'body_fat', target: 15 }, weight, bf).phase).toBe('cut');
    expect(goalPhase({ kind: 'body_fat', target: 15 }, weight, null).reason).toMatch(/body-fat reading/);
  });

  it('narrows the cutting band as body fat falls, with sex-specific bands', () => {
    expect(bodyFatLevel(17.9, 'male')).toBe('moderate');
    expect(bodyFatLevel(17.9, 'female')).toBe('lean');
    expect(bodyFatLevel(12, null)).toBe('lean');
    expect(recommendedBand('cut', 12, 'male')).toMatchObject({ minPct: 0.5, maxPct: 0.75 });
    expect(recommendedBand('cut', 30, 'male')).toMatchObject({ minPct: 0.75, maxPct: 1.0 });
    expect(recommendedBand('cut', null, null)).toMatchObject({ minPct: 0.5, maxPct: 1.0 });
    expect(recommendedBand('cut', 18, null).basis).toMatch(/until sex is set/);
    expect(recommendedBand('bulk', 18, 'male')).toMatchObject({ minPct: 0.25, maxPct: 0.5 });
  });

  it('follows the phase direction for a custom pace and the band middle otherwise', () => {
    const band = recommendedBand('cut', 18, 'male');
    expect(effectivePace('cut', band, 80, null)).toMatchObject({ kgPerWeek: -0.6, pct: 0.75, source: 'recommended' });
    expect(effectivePace('cut', band, 80, 0.5)).toMatchObject({ kgPerWeek: -0.5, source: 'custom' });
    expect(effectivePace('bulk', recommendedBand('bulk', 18, 'male'), 80, -0.3).kgPerWeek).toBeCloseTo(0.3);
    expect(effectivePace('maintain', band, 80, 0.5).kgPerWeek).toBe(0);
  });

  it('describes the trend against the band without judging it', () => {
    const band = recommendedBand('cut', 18, 'male');
    expect(trendFit('cut', band, -1.15)).toBe('faster');
    expect(trendFit('cut', band, -0.7)).toBe('within');
    expect(trendFit('cut', band, -0.3)).toBe('slower');
    expect(trendFit('cut', band, 0.3)).toBe('opposite');
    expect(trendFit('cut', band, 0.01)).toBe('steady');
    expect(trendFit('maintain', band, 0.5)).toBe('drifting');
  });
});

describe('targets', () => {
  it('sets calories from maintenance and the pace, and protein per kg', () => {
    const t = nutritionTargets({ phase: 'cut', maintenance: 3050, paceKgPerWeek: -0.5, weightKg: 79.2, leanKg: 65 });
    expect(t.dailyEnergyDelta).toBe(-550);
    expect(t.calories).toEqual({ min: 2425, max: 2575 });
    expect(t.protein).toEqual({ min: 125, max: 175 });
    expect(t.fatFloor).toBe(50);
    expect(t.carbs!.min).toBeGreaterThan(150);
    expect(t.fiber!.min).toBeGreaterThan(30);
    expect(t.proteinPerLeanKg!.max).toBeCloseTo(175 / 65);
  });

  it('keeps protein and fat targets without a maintenance estimate', () => {
    const t = nutritionTargets({ phase: 'bulk', maintenance: null, paceKgPerWeek: 0.3, weightKg: 70, leanKg: null });
    expect(t.calories).toBeNull();
    expect(t.carbs).toBeNull();
    expect(t.protein).toEqual({ min: 110, max: 140 });
  });
});

describe('composition', () => {
  it('matches the milestone goal-weight table for 15 % body fat', () => {
    // 174.6 lb at 17.9 % → 31.25 lb fat. Unit-free, so pounds work.
    const fat = 174.6 * 0.179;
    expect(changeToTarget(174.6, fat, 15, 0)!).toBeCloseTo(-5.96, 1);
    expect(changeToTarget(174.6, fat, 15, 0.2)!).toBeCloseTo(-7.79, 1);
    expect(changeToTarget(174.6, fat, 15, 0.36)!).toBeCloseTo(-10.4, 0);
  });

  it('works for gaining to a body-fat ceiling', () => {
    // 70 kg at 12 %: gaining with 40 % lean reaches 15 % after Δ = (10.5 − 8.4) / (0.6 − 0.15).
    expect(changeToTarget(70, 8.4, 15, 0.4)!).toBeCloseTo(4.67, 1);
  });
});

describe('projection', () => {
  const band = recommendedBand('cut', 18, 'male');
  const fmt = (kg: number) => `${kg.toFixed(2)} kg`;

  it('projects arrival at the band ends, the pace in use and the trend', () => {
    const pace = effectivePace('cut', band, 80, null);
    const p = projectArrival({ phase: 'cut', remainingKg: -4, weightKg: 80, band, pace, trendKgPerWeek: -0.9, today: TODAY, formatRate: fmt });
    expect(p.rows.map(r => r.id)).toEqual(['band-slow', 'chosen', 'band-fast', 'trend']);
    expect(p.chosen!.weeks).toBeCloseTo(4 / 0.6);
    expect(p.chosen!.arrival).toBe(addDays(TODAY, Math.round((4 / 0.6) * 7)));
    expect(p.trendNote).toBeNull();
  });

  it('describes a trend moving away without calling anyone behind', () => {
    const pace = effectivePace('cut', band, 80, null);
    const away = projectArrival({ phase: 'cut', remainingKg: -4, weightKg: 80, band, pace, trendKgPerWeek: 0.3, today: TODAY, formatRate: fmt });
    const flat = projectArrival({ phase: 'cut', remainingKg: -4, weightKg: 80, band, pace, trendKgPerWeek: 0.01, today: TODAY, formatRate: fmt });
    expect(away.rows.some(r => r.id === 'trend')).toBe(false);
    expect(away.trendNote).toMatch(/away from the goal/);
    expect(flat.trendNote).toMatch(/held steady/);
    for (const text of [away.trendNote, flat.trendNote]) expect(text).not.toMatch(/behind|overdue|late|missed/i);
  });
});

describe('macro consistency', () => {
  it('finds a repeated fat excess and switches to derived fat', () => {
    const c = macroConsistency(lookup(cutSeries()), addDays(TODAY, -28), addDays(TODAY, -1));
    expect(c.checked).toBeGreaterThan(20);
    expect(c.recurringExcessFatG!).toBeCloseTo(86, 0);
    expect(c.useDerivedFat).toBe(true);
    expect(c.summary).toMatch(/about 86 g more/);
  });

  it('says the totals add up when they do', () => {
    const data = cutSeries();
    data.dietary_fat_total = data.dietary_energy.map(d => ({ key: d.key, value: d.value === 900 ? (900 - 4 * 80 - 4 * 60) / 9 : (2066 - 4 * 181 - 4 * 163) / 9 }));
    const c = macroConsistency(lookup(data), addDays(TODAY, -28), addDays(TODAY, -1));
    expect(c.over).toHaveLength(0);
    expect(c.useDerivedFat).toBe(false);
    expect(c.summary).toMatch(/add up to the calories/);
  });
});

describe('monthly intake', () => {
  it('averages complete logged days per month and counts the protein floor', () => {
    const rows = monthlyIntake(lookup(cutSeries()), TODAY, { months: 3, proteinFloor: 150 });
    expect(rows.map(r => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    const sep = rows[1];
    expect(sep.loggedDays).toBe(30);
    expect(sep.partialDays).toBeGreaterThan(0);
    expect(sep.kcal).toBeCloseTo(2066, 0);
    expect(sep.derivedFat!).toBeCloseTo((2066 - 4 * 181 - 4 * 163) / 9, 0);
    expect(sep.daysAtProteinFloor).toBe(sep.completeDays);
    expect(sep.proteinPerKg!).toBeGreaterThan(2);
    expect(rows[2].to).toBe(addDays(TODAY, -1));
  });
});

describe('bodyGoalReport', () => {
  it('pulls the cut together for a body-fat goal', () => {
    const report = bodyGoalReport(goal(), { series: lookup(cutSeries()), workoutDays: [], today: TODAY, sex: 'male', system: 'imperial' });
    expect(report.phase.phase).toBe('cut');
    expect(report.band).toMatchObject({ minPct: 0.5, maxPct: 1.0 });
    expect(report.fit).toBe('faster');
    expect(report.scenarios.map(s => s.id)).toEqual(['ideal', 'realistic', 'observed']);
    expect(report.goalWeightKg!).toBeLessThan(report.weight.current!.value);
    expect(report.progress!).toBeGreaterThan(0);
    expect(report.progress!).toBeLessThan(1);
    expect(report.targets!.calories!.min).toBeGreaterThan(2200);
    expect(report.effects.rate!.status).toBe('watch');
    expect(report.consistency.useDerivedFat).toBe(true);

    const summary = bodyGoalSummary(report, 'imperial');
    expect(summary.weightUnit).toBe('lb');
    expect(summary.trend.perWeek!).toBeCloseTo(-2, 0);
    expect(summary.maintenanceKcal.used!).toBeGreaterThan(3000);
    expect(summary.flags.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toMatch(/behind|overdue/i);
  });

  it('turns into a bulk when the target is above the current weight', () => {
    const report = bodyGoalReport(goal({ kind: 'weight', target: 85, paceKgPerWeek: 0.25 }), { series: lookup(cutSeries()), workoutDays: [], today: TODAY, sex: null, system: 'metric' });
    expect(report.phase.phase).toBe('bulk');
    expect(report.pace).toMatchObject({ kgPerWeek: 0.25, source: 'custom' });
    expect(report.targets!.dailyEnergyDelta).toBeGreaterThan(0);
    expect(report.projection!.trendNote).toMatch(/away from the goal/);
    expect(report.bodyFatAtGoal).not.toBeNull();
  });

  it('shows no progress on the day a goal is set', () => {
    const report = bodyGoalReport(goal({ kind: 'weight', target: 85, startedOn: TODAY }), { series: lookup(cutSeries()), workoutDays: [], today: TODAY, sex: null, system: 'metric' });
    expect(report.start.value).toBeCloseTo(report.weight.current!.value, 6);
    expect(report.progress).toBe(0);
  });

  it('measures from today when the goal starts after the data ends', () => {
    const report = bodyGoalReport(goal({ startedOn: addDays(TODAY, 10) }), { series: lookup(cutSeries()), workoutDays: [], today: TODAY, sex: 'male', system: 'metric' });
    expect(report.anchor).toBe(TODAY);
    expect(report.progress).toBe(0);
  });

  it('explains a body-fat goal with no body-fat data', () => {
    const data = cutSeries();
    delete (data as Record<string, unknown>).body_fat_percentage;
    const report = bodyGoalReport(goal(), { series: lookup(data), workoutDays: [], today: TODAY, sex: 'male', system: 'metric' });
    expect(report.phase.phase).toBeNull();
    expect(report.phase.reason).toMatch(/body-fat reading/);
    expect(report.targets).toBeNull();
  });
});
