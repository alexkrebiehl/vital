'use client';

// ── Body → Nutrition: eating against the goal ───────────
//
// With a goal: the daily targets the goal implies beside what was logged, and
// how many logged days met them. Always: the month-by-month log and whether
// the logged macros add up to the logged calories. Averages are over complete
// logged days only — an unlogged day is absent, never zero.

import Link from 'next/link';
import { useMemo } from 'react';
import { ChevronRight, Target } from 'lucide-react';
import { Card, DataStateNote, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { SectionTitle } from '@/components/domain/DomainShared';
import { REFERENCE_KEY, metricHasData, seriesFor } from '@/lib/adapters/dataset';
import { addDays, formatDayKeyLong } from '@/lib/analytics/windows';
import { TREND_DAYS } from '@/lib/body-goal/constants';
import { macroConsistency, type MacroConsistency } from '@/lib/body-goal/consistency';
import { monthlyIntake, type Adherence, type MonthIntake } from '@/lib/body-goal/intake';
import { PHASE_LABEL } from '@/lib/body-goal/phase';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { BodyGoal } from '@/lib/body-goal/types';
import type { UnitSystem } from '@/lib/prefs';
import type { GoalLoad } from './useBodyGoal';
import { formatGrams, formatKcal, formatPerWeightRange, formatRange, formatRate, weightUnit } from './format';

const KG_PER_LB = 0.45359237;

/** The page loads the goal once and shares its report with the adherence cards at the top. */
export function NutritionGoalPanel({ state, active, report }: { state: GoalLoad; active: BodyGoal | null; report: BodyGoalReport | null }) {
  const { units } = useUnits();
  const meta = useDatasetMeta();

  // Without a goal the month table and the consistency check still stand on their own.
  const standalone = useMemo(
    () => ({
      months: monthlyIntake(seriesFor, REFERENCE_KEY),
      consistency: macroConsistency(seriesFor, addDays(REFERENCE_KEY, -TREND_DAYS), addDays(REFERENCE_KEY, -1)),
    }),
    // The dataset is module state; its identity changes with the meta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.generatedAt, meta.referenceKey]
  );
  const months = report?.months ?? standalone.months;
  const foodLogged = metricHasData('dietary_energy');
  const consistency = report?.consistency ?? standalone.consistency;

  return (
    <div className="space-y-8">
      {state.status === 'loading' ? (
        <Card className="p-5"><Skeleton height={18} width="50%" /></Card>
      ) : report?.targets ? (
        <TargetsSection report={report} units={units} />
      ) : (
        <Card variant="accent" className="p-5" as="section">
          <div className="flex items-start gap-3">
            <Target size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <div className="text-sm space-y-1">
              <p className="font-medium text-text-primary">
                {active ? 'Targets need a current weigh-in' : 'Set a goal to see daily targets'}
              </p>
              <p className="text-text-secondary leading-relaxed">
                {active
                  ? report?.phase.reason ?? 'The targets are worked out from your current weight and trend.'
                  : `With a target weight or body-fat percentage, this page shows calories, protein, carbs, fat and fiber to aim for${foodLogged ? ', and how many logged days met them' : ' — no food log needed'}.`}
              </p>
              <Link href="/body" className="inline-flex items-center gap-1 text-primary hover:underline">
                {active ? 'Open Body' : 'Set a goal on Body'} <ChevronRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </Card>
      )}
      {months.length > 0 && <MonthsSection months={months} consistency={consistency} units={units} showFloor={report?.targets ? report.targets.proteinFloor : null} />}
      {consistency.checked > 0 && <ConsistencySection consistency={consistency} />}
    </div>
  );
}

// ── Targets ─────────────────────────────────────────────

function TargetsSection({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const t = report.targets!;
  const a = report.adherence as Adherence;
  // Most people do not log food: then the targets stand on their own, with no
  // "logged" or "days" columns to sit empty.
  const logged = report.energy.foodLogged && a.completeDays > 0;
  const derived = report.consistency.useDerivedFat;
  const fatAvg = derived ? a.averages.derivedFat : a.averages.fat;
  const days = (n: number | null, of: number) => (n === null || of === 0 ? '—' : `${n} of ${of}`);
  const phase = report.phase.phase!;
  const rows = [
    t.calories && {
      label: 'Calories',
      target: formatRange(t.calories, 'kcal'),
      note: t.caloriesOk ? `OK ${formatRange(t.caloriesOk, 'kcal')}` : null,
      logged: formatKcal(a.averages.kcal),
      met: days(a.caloriesInRange, a.completeDays),
      metNote: 'on target',
    },
    {
      label: 'Protein',
      target: `${formatRange(t.protein, 'g')}${t.proteinPerLeanKg ? ` · ${formatPerWeightRange(t.proteinPerLeanKg, units)} lean` : ''}`,
      note: `OK from ${t.proteinOkFloor} g`,
      logged: formatGrams(a.averages.protein),
      met: days(a.proteinAtFloor, a.proteinDays),
      metNote: `at ${t.proteinFloor} g or more`,
    },
    t.carbs && { label: 'Carbs', target: formatRange(t.carbs, 'g'), note: 'the rest of the calories', logged: formatGrams(a.averages.carbs), met: '', metNote: '' },
    { label: derived ? 'Fat (derived†)' : 'Fat', target: `at least ${t.fatFloor} g${t.fat ? ` · typically ${formatRange(t.fat, 'g')}` : ''}`, note: 'the floor supports hormone health', logged: formatGrams(fatAvg), met: '', metNote: '' },
    t.fiber && { label: 'Fiber', target: formatRange(t.fiber, 'g'), logged: formatGrams(a.averages.fiber), met: days(a.fiberAtTarget, a.fiberDays), metNote: 'at target' },
  ].filter((r): r is NonNullable<typeof r> & object => Boolean(r));
  const maintenance = report.energy.maintenance;
  const calorieNote =
    maintenance === null
      ? 'There is no maintenance estimate yet — it needs basal and active energy from a watch, or a few weeks of logged food — so there is no calorie target. The weight trend on Body is the guide.'
      : phase === 'maintain'
        ? `Calories are set at maintenance (${formatKcal(maintenance)} a day) to hold the goal.`
        : `Calories are maintenance (${formatKcal(maintenance)} a day, ${report.energy.maintenanceSource === 'weight-trend' ? 'from your weight trend' : 'your watch’s estimate'}) ${t.dailyEnergyDelta < 0 ? 'minus' : 'plus'} ${formatKcal(Math.abs(t.dailyEnergyDelta))} for ${formatRate(report.pace!.kgPerWeek, units)}.`;
  return (
    <section>
      <SectionTitle hint={logged ? `${PHASE_LABEL[phase]} · logged days ${formatDayKeyLong(a.from)} – ${formatDayKeyLong(a.to)}` : PHASE_LABEL[phase]}>
        Daily targets for your goal
      </SectionTitle>
      <Card className="p-4 md:p-6">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={logged ? 'Daily targets against logged intake' : 'Daily targets'}>
          <table className="w-full text-sm text-left">
            <caption className="sr-only">
              {logged ? 'Daily targets for the goal beside the average of complete logged days' : 'Daily targets for the goal'}
            </caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Nutrient</th>
                <th scope="col" className="py-2 pr-4 font-medium">Target per day</th>
                {logged && <th scope="col" className="py-2 pr-4 font-medium">Logged average</th>}
                {logged && <th scope="col" className="py-2 font-medium">Days</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-b border-border/50 text-text-primary">
                  <td className="py-2.5 pr-4">{r.label}</td>
                  <td className="py-2.5 pr-4 tnum">
                    {r.target}
                    {'note' in r && r.note && <span className="block text-xs text-text-secondary">{r.note}</span>}
                  </td>
                  {logged && <td className="py-2.5 pr-4 tnum">{r.logged}</td>}
                  {logged && (
                    <td className="py-2.5 tnum text-[12px]">
                      {r.met} <span className="text-text-secondary">{r.metNote}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1">
          <DataStateNote>
            {calorieNote} Protein is set per {weightUnit(units)} of body weight, higher in a deficit to keep muscle.
          </DataStateNote>
          <DataStateNote>{t.checkIn}</DataStateNote>
          {logged ? (
            <DataStateNote>
              {a.completeDays} complete logged days{a.partialDays ? `; ${a.partialDays} partial log${a.partialDays === 1 ? '' : 's'} left out` : ''}. Days without a log are not counted.
            </DataStateNote>
          ) : (
            <DataStateNote>
              No food is logged in the last four weeks, which is fine — these are targets to eat to, not a log to keep. If you
              log meals in an app that writes to Apple Health, this table also shows how your days compare.
            </DataStateNote>
          )}
          {logged && derived && <DataStateNote>† Derived from calories, protein and carbs, because the logged fat does not add up (see Log consistency).</DataStateNote>}
        </div>
      </Card>
    </section>
  );
}

// ── Month by month ──────────────────────────────────────

function MonthsSection({ months, consistency, units, showFloor }: { months: MonthIntake[]; consistency: MacroConsistency; units: UnitSystem; showFloor: number | null }) {
  const derived = consistency.useDerivedFat;
  const perWeight = (gPerKg: number | null) =>
    gPerKg === null ? '—' : units === 'imperial' ? `${(gPerKg * KG_PER_LB).toFixed(2)} g/lb` : `${gPerKg.toFixed(1)} g/kg`;
  return (
    <section>
      <SectionTitle hint="complete logged days only">Month by month</SectionTitle>
      <Card className="p-4 md:p-6">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Logged intake by month">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Average logged intake per month over complete logged days</caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-3 font-medium">Month</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Days logged</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Calories</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Protein</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Per body weight</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Carbs</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">{derived ? 'Fat†' : 'Fat'}</th>
                <th scope="col" className="py-2 pr-3 font-medium text-right">Fiber</th>
                {showFloor !== null && <th scope="col" className="py-2 font-medium text-right">Days ≥ {showFloor} g protein</th>}
              </tr>
            </thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month} className="border-b border-border/50 text-text-primary tnum">
                  <td className="py-2 pr-3 whitespace-nowrap">{m.label}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {m.loggedDays}{m.partialDays > 0 && <span className="text-text-secondary"> ({m.partialDays} partial)</span>}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{formatKcal(m.kcal)}</td>
                  <td className="py-2 pr-3 text-right">{formatGrams(m.protein)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{perWeight(m.proteinPerKg)}</td>
                  <td className="py-2 pr-3 text-right">{formatGrams(m.carbs)}</td>
                  <td className="py-2 pr-3 text-right">{formatGrams(derived ? m.derivedFat : m.fat)}</td>
                  <td className="py-2 pr-3 text-right">{formatGrams(m.fiber)}</td>
                  {showFloor !== null && <td className="py-2 text-right">{m.daysAtProteinFloor ?? '—'} / {m.completeDays}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1">
          <DataStateNote>
            A logged day far below the usual (under 60 % of the median) is treated as a partial log: it is counted in
            &ldquo;Days logged&rdquo; but left out of the averages.
          </DataStateNote>
          {derived && <DataStateNote>† Fat derived from calories, protein and carbs: (kcal − 4 × protein − 4 × carbs) ÷ 9.</DataStateNote>}
        </div>
      </Card>
    </section>
  );
}

// ── Log consistency ─────────────────────────────────────

function ConsistencySection({ consistency }: { consistency: MacroConsistency }) {
  const flagged = [...consistency.over, ...consistency.under].sort((a, b) => b.key.localeCompare(a.key));
  return (
    <section>
      <SectionTitle hint={`last ${TREND_DAYS} days`}>Log consistency</SectionTitle>
      <Card className="p-4 md:p-6">
        <p className="text-sm text-text-primary leading-relaxed">{consistency.summary}</p>
        {flagged.length > 0 && (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Days whose macros and calories disagree">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-3 font-medium">Day</th>
                  <th scope="col" className="py-2 pr-3 font-medium text-right">Logged calories</th>
                  <th scope="col" className="py-2 pr-3 font-medium text-right">From macros</th>
                  <th scope="col" className="py-2 pr-3 font-medium text-right">Logged fat</th>
                  <th scope="col" className="py-2 font-medium text-right">Fat that fits</th>
                </tr>
              </thead>
              <tbody>
                {flagged.slice(0, 10).map(d => (
                  <tr key={d.key} className="border-b border-border/50 text-text-primary tnum">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDayKeyLong(d.key)}</td>
                    <td className="py-2 pr-3 text-right">{formatKcal(d.kcal)}</td>
                    <td className="py-2 pr-3 text-right">{formatKcal(d.computed)}</td>
                    <td className="py-2 pr-3 text-right">{formatGrams(d.fat)}</td>
                    <td className="py-2 text-right">{formatGrams(d.derivedFat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {flagged.length > 10 && <p className="mt-2 text-[11px] text-text-secondary">And {flagged.length - 10} more.</p>}
          </div>
        )}
        <div className="mt-3">
          <DataStateNote>
            Protein and carbs carry 4 kcal per gram and fat 9, so on a fully logged day 4 × protein + 4 × carbs + 9 × fat
            should come close to the logged calories.
          </DataStateNote>
        </div>
      </Card>
    </section>
  );
}
