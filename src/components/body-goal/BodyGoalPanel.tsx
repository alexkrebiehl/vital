'use client';

// ── Body → Overview: the goal and what bears on it ──────
//
// The goal card (set, edit, end), and the goal read through the data: the
// energy balance, how long each pace would take, what is driving the change
// and how the body is responding. The Body page puts its weight trajectory
// (WeightTrajectory) between the two. Every
// section is shown only when there is data for it, and nothing here measures
// the reader against a deadline — arrival dates are projections from a pace.

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, Target } from 'lucide-react';
import { Badge, Button, Card, DataStateNote, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { SectionTitle } from '@/components/domain/DomainShared';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { TREND_DAYS } from '@/lib/body-goal/constants';
import { PHASE_LABEL } from '@/lib/body-goal/phase';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { EffectStatus } from '@/lib/body-goal/effects';
import type { UnitSystem } from '@/lib/prefs';
import { GoalDialog } from './GoalDialog';
import { PaceScale } from './PaceScale';
import type { useBodyGoal } from './useBodyGoal';
import {
  formatGrams,
  formatKcal,
  formatKg,
  formatPct,
  formatRange,
  formatRate,
  formatSignedKcal,
  formatSignedKg,
  formatWeeks,
  FIT_TEXT,
} from './format';


const STATUS_BADGE: Record<EffectStatus | 'warn' | 'unknown', { variant: 'success' | 'warning' | 'default'; label: string }> = {
  ok: { variant: 'success', label: 'Fine' },
  watch: { variant: 'warning', label: 'Watch' },
  warn: { variant: 'warning', label: 'Watch' },
  info: { variant: 'default', label: 'Info' },
  unknown: { variant: 'default', label: 'No data' },
};

/**
 * The goal card: set a goal, or the goal with its progress, pace and arrival.
 * `goal` and `report` are the page's one read of the goal (the weight chart
 * and the sections below use the same report).
 */
export function BodyGoalCard({ goal, report }: { goal: ReturnType<typeof useBodyGoal>; report: BodyGoalReport | null }) {
  const { units } = useUnits();
  const { state, active, save, end } = goal;
  const [editing, setEditing] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <Card className="p-6 space-y-3" aria-label="Loading your goal">
        <Skeleton height={18} width="40%" />
        <Skeleton height={36} width="60%" />
        <Skeleton height={10} />
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card className="p-5">
        <ErrorState title="Your goal could not be loaded" message={state.message} />
      </Card>
    );
  }

  const dialog = <GoalDialog open={editing} onClose={() => setEditing(false)} existing={active} onSave={save} />;

  if (!active || !report) {
    return (
      <>
        <Card variant="accent" className="p-5" as="section">
          <EmptyState
            icon={<Target size={22} aria-hidden="true" />}
            title="Set a goal"
            description="Choose a target body weight or body-fat percentage. This page and Nutrition will then show your pace, your maintenance calories, targets for eating, and how your recovery and lean mass are holding up — whether you are cutting, gaining or maintaining."
            action={<Button variant="primary" size="sm" onClick={() => setEditing(true)}>Set a goal</Button>}
          />
        </Card>
        {dialog}
      </>
    );
  }

  return (
    <>
      <GoalCard
        report={report}
        units={units}
        history={state.data.history.length}
        onEdit={() => setEditing(true)}
        onEnd={async () => {
          setEndError(null);
          try {
            await end();
          } catch (e) {
            setEndError(e instanceof Error ? e.message : 'The goal could not be ended.');
          }
        }}
        endError={endError}
      />
      {dialog}
    </>
  );
}

/** The goal read through the data: energy balance, pace, what drives it, how the body responds. */
export function BodyGoalSections({ report }: { report: BodyGoalReport | null }) {
  const { units } = useUnits();
  if (!report) return null;
  return (
    <>
      <EnergySection report={report} units={units} />
      <PaceSection report={report} units={units} />
      <DriversSection report={report} />
      <ResponseSection report={report} />
    </>
  );
}

// ── Goal card ───────────────────────────────────────────

function goalTitle(report: BodyGoalReport, units: UnitSystem): string {
  return report.goal.kind === 'weight' ? formatKg(report.goal.target, units) : `${formatPct(report.goal.target)} body fat`;
}

function goalValue(report: BodyGoalReport, value: number | null, units: UnitSystem): string {
  if (value === null) return '—';
  return report.goal.kind === 'weight' ? formatKg(value, units) : formatPct(value);
}

function GoalCard({
  report, units, history, onEdit, onEnd, endError,
}: {
  report: BodyGoalReport;
  units: UnitSystem;
  history: number;
  onEdit: () => void;
  onEnd: () => void;
  endError: string | null;
}) {
  const { phase, weight, pace, band, projection } = report;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const progress = report.progress;

  return (
    <Card className="p-5 md:p-6" as="section" aria-label="Your goal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <Target size={14} aria-hidden="true" />
            Your goal
            {phase.phase && <Badge variant="accent">{PHASE_LABEL[phase.phase]}</Badge>}
          </div>
          <p className="mt-1 text-[28px] md:text-[32px] font-semibold tnum leading-tight text-text-primary">{goalTitle(report, units)}</p>
          <p className="text-[11px] text-text-secondary">
            Set {formatDayKeyLong(report.goal.startedOn)}
            {pace?.source === 'custom' && ` · your pace: ${formatRate(pace.kgPerWeek, units)}`}
            {history > 0 && ` · ${history} earlier goal${history === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onEdit}>Edit goal</Button>
          {confirmEnd ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>Keep it</Button>
              <Button size="sm" variant="danger" onClick={onEnd}>End goal</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>End…</Button>
          )}
          <DiscussButton context={{ kind: 'body-goal' }} subject="your body goal" suggestions={suggestions(report)} />
        </div>
      </div>
      {endError && <p className="mt-2 text-sm text-category-attention" role="alert">{endError}</p>}

      {phase.reason ? (
        <p className="mt-4 text-sm text-text-secondary">{phase.reason}</p>
      ) : (
        <>
          {progress !== null && (
            <div className="mt-5">
              <div className="h-2.5 rounded-full bg-surface-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progress toward the goal">
                <div className="h-full rounded-full bg-category-body" style={{ width: `${Math.max(2, progress * 100)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-text-secondary tnum">
                <span>Start {goalValue(report, report.start.value, units)}</span>
                <span className="text-text-primary font-medium">Now {goalValue(report, phase.current, units)} · {Math.round(progress * 100)} %</span>
                <span>Goal {goalTitle(report, units)}</span>
              </div>
            </div>
          )}

          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-text-secondary">Trend, last four weeks</dt>
              <dd className="mt-0.5 font-medium tnum text-text-primary">
                {weight.rateKgPerWeek !== null ? formatRate(weight.rateKgPerWeek, units) : '—'}
                {weight.ratePct !== null && <span className="text-text-secondary font-normal"> · {formatPct(Math.abs(weight.ratePct), 2)} of body weight</span>}
              </dd>
              <dd className="text-[11px] text-text-secondary">
                {FIT_TEXT[report.fit]}
                {band && phase.phase !== 'maintain' && ` (${band.minPct}–${band.maxPct} % a week)`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">{phase.phase === 'maintain' ? 'Goal' : 'Projected arrival'}</dt>
              <dd className="mt-0.5 font-medium tnum text-text-primary">
                {phase.phase === 'maintain'
                  ? 'Reached — holding steady'
                  : projection?.chosen ? formatDayKeyLong(projection.chosen.arrival) : '—'}
              </dd>
              <dd className="text-[11px] text-text-secondary">
                {phase.phase !== 'maintain' && projection?.chosen && `${formatWeeks(projection.chosen.weeks)} at ${pace?.source === 'custom' ? 'your pace' : 'the recommended pace'} of ${formatRate(pace!.kgPerWeek, units)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">{report.goal.kind === 'body_fat' ? 'Goal weight, realistic' : 'Weight to go'}</dt>
              <dd className="mt-0.5 font-medium tnum text-text-primary">
                {report.goal.kind === 'body_fat'
                  ? report.goalWeightKg !== null ? formatKg(report.goalWeightKg, units) : '—'
                  : projection ? formatSignedKg(projection.remainingKg, units) : '—'}
              </dd>
              <dd className="text-[11px] text-text-secondary">
                {report.goal.kind === 'body_fat'
                  ? 'Depends on how much of the change is lean mass (see below)'
                  : report.bodyFatAtGoal !== null ? `About ${formatPct(report.bodyFatAtGoal)} body fat there, at a typical lean share` : ''}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}

function suggestions(report: BodyGoalReport): string[] {
  const out = ['Am I on a good pace for my goal?', 'What should I eat to hit my targets?'];
  if (report.effects.rate?.status === 'watch') out.unshift('Is my current rate too fast?');
  if (report.phase.phase === 'bulk') out.push('How do I keep the gain mostly muscle?');
  return out.slice(0, 3);
}

// ── Energy balance ──────────────────────────────────────

function EnergySection({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const e = report.energy;
  const rows: { label: string; value: string; note?: string }[] = [];
  const trendRow = e.trendBalance !== null && {
    label: 'Daily balance, from your weight trend',
    value: formatSignedKcal(e.trendBalance),
    note: `${e.trendBalance < 0 ? 'A deficit' : 'A surplus'} of about this much a day is what moving ${formatRate(e.weightRateKgPerWeek!, units)} takes (7,700 kcal per kg). It needs only weigh-ins.`,
  };
  const deviceRow = {
    label: 'Maintenance, device estimate',
    value: e.device !== null ? `${formatKcal(e.device)}/day` : '—',
    note: e.device !== null
      ? `Basal ${formatKcal(e.deviceBasal)} + active ${formatKcal(e.deviceActive)}, ${e.deviceDays} days. Basal is computed from body weight, so it falls as weight falls.`
      : e.deviceReason ?? undefined,
  };

  if (!e.foodLogged) {
    // The common case: no food log. Everything here comes from weigh-ins and the watch.
    if (trendRow) rows.push(trendRow);
    if (e.device !== null) rows.push(deviceRow);
    if (rows.length === 0) return null;
  } else {
    rows.push(
      {
        label: 'Logged intake',
        value: e.intake !== null ? `${formatKcal(e.intake)}/day` : '—',
        note: `${e.days.complete.length} complete logged days in the last ${TREND_DAYS}${e.days.partial.length ? `; ${e.days.partial.length} partial log${e.days.partial.length === 1 ? '' : 's'} left out (${e.days.partial.map(d => formatDayKeyLong(d.key)).join(', ')})` : ''}`,
      },
      {
        label: 'Maintenance, from your weight trend',
        value: e.adaptive !== null ? `${formatKcal(e.adaptive)}/day` : '—',
        note: e.adaptive !== null ? 'Logged intake minus the weight trend in energy (7,700 kcal per kg).' : e.adaptiveReason ?? undefined,
      },
      deviceRow,
    );
    if (e.balance !== null) {
      rows.push({
        label: 'Daily balance',
        value: formatSignedKcal(e.balance),
        note: e.balance < 0 ? 'A deficit: eating below maintenance.' : 'A surplus: eating above maintenance.',
      });
    } else if (trendRow) {
      rows.push(trendRow);
    }
  }

  return (
    <section>
      <SectionTitle hint={`last ${TREND_DAYS} days${e.foodLogged ? ' · logged days only' : ''}`}>Energy balance</SectionTitle>
      <Card className="p-4 md:p-6">
        <dl className="divide-y divide-border">
          {rows.map(r => (
            <div key={r.label} className="py-2.5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4">
              <dt className="text-sm text-text-primary">{r.label}</dt>
              <dd className="text-sm font-medium tnum text-text-primary sm:text-right">{r.value}</dd>
              {r.note && <dd className="text-[11px] text-text-secondary sm:col-span-2">{r.note}</dd>}
            </div>
          ))}
        </dl>
        <div className="mt-3 space-y-1">
          {e.agreementText && <DataStateNote>{e.agreementText}</DataStateNote>}
          {!e.foodLogged && (
            <DataStateNote>
              No food is logged, which is fine — the goal is tracked from your weigh-ins. If you do log meals in an app that
              writes to Apple Health, maintenance is also worked out from what you eat and how your weight moves.
            </DataStateNote>
          )}
        </div>
      </Card>
    </section>
  );
}

// ── Pace options ────────────────────────────────────────

function PaceSection({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const p = report.projection;
  const scenarios = report.scenarios;
  if ((!p || p.rows.length === 0) && scenarios.length === 0) return null;
  return (
    <section>
      <SectionTitle hint="projections, not deadlines">How long, at which pace</SectionTitle>
      <div className={`grid grid-cols-1 gap-4 ${scenarios.length > 0 && p && p.rows.length > 0 ? 'xl:grid-cols-[3fr_2fr]' : ''}`}>
        {p && p.rows.length > 0 && (
          <Card className="p-4 md:p-6">
            <PaceScale report={report} units={units} />
          </Card>
        )}
        {scenarios.length > 0 && (
          <Card className="p-4 md:p-6">
            <p className="text-sm font-medium text-text-primary mb-2">Goal weight for {formatPct(report.goal.target)} body fat</p>
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-3 font-medium">If…</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Goal weight</th>
                  <th scope="col" className="py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map(s => (
                  <tr key={s.id} className={`border-b border-border/50 ${s.id === 'realistic' ? 'font-medium' : ''} text-text-primary`}>
                    <td className="py-2 pr-3">{s.label}</td>
                    <td className="py-2 pr-3 tnum whitespace-nowrap">{formatKg(s.goalWeightKg, units)}</td>
                    <td className="py-2 tnum whitespace-nowrap">{formatSignedKg(s.changeKg, units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3">
              <DataStateNote>
                Scale body-fat readings can be off by 3–5 points. Judge the goal by the seven-day trend and a waist
                measurement as much as by a single reading.
              </DataStateNote>
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}

// ── What is driving it ──────────────────────────────────

function DriversSection({ report }: { report: BodyGoalReport }) {
  const t = report.targets;
  const a = report.adherence;
  const activity = report.effects.activity;
  const logged = report.energy.foodLogged;
  if (!t && activity.rows.length === 0) return null;
  const fmt = (id: string, v: number | null) => {
    if (v === null) return '—';
    if (id === 'active_energy') return formatKcal(v);
    if (id === 'step_count') return Math.round(v).toLocaleString('en-US');
    return v.toFixed(id === 'workouts' ? 1 : 0);
  };
  return (
    <section>
      <SectionTitle hint={`last ${TREND_DAYS} days`}>What is driving it</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {t && (
          <Card className="p-4 md:p-6 flex flex-col">
            {logged ? (
              <>
                <p className="text-sm font-medium text-text-primary mb-3">Eating, against the targets</p>
                <dl className="text-sm space-y-2">
                  {t.calories && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Calories</dt>
                      <dd className="tnum text-text-primary text-right">
                        {formatKcal(a?.averages.kcal ?? null)} <span className="text-text-secondary">· target {formatRange(t.calories, 'kcal')}</span>
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Protein</dt>
                    <dd className="tnum text-text-primary text-right">
                      {formatGrams(a?.averages.protein ?? null)} <span className="text-text-secondary">· target {formatRange(t.protein, 'g')}</span>
                    </dd>
                  </div>
                  {a && a.completeDays > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Days on target</dt>
                      <dd className="tnum text-text-primary text-right">
                        {a.caloriesInRange !== null && `${a.caloriesInRange} of ${a.completeDays} in the calorie range · `}
                        {a.proteinAtFloor} of {a.proteinDays} at {t.proteinFloor} g protein or more
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-text-primary mb-3">Eating for this pace</p>
                <dl className="text-sm space-y-2">
                  {t.calories && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Calories</dt>
                      <dd className="tnum text-text-primary text-right">{formatRange(t.calories, 'kcal')} a day</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Protein</dt>
                    <dd className="tnum text-text-primary text-right">{formatRange(t.protein, 'g')} a day</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11px] text-text-secondary leading-relaxed">
                  {t.calories
                    ? 'Calories are your watch’s maintenance estimate adjusted for the pace. Nothing needs logging: if the weight trend runs faster or slower than the pace, eat a little more or less.'
                    : 'Without a food log or basal energy from a watch there is no maintenance estimate, so there is no calorie number — the weight trend above is the guide. Protein is set from body weight.'}
                </p>
              </>
            )}
            <div className="mt-auto pt-3">
              <Link href="/body/nutrition" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                {logged ? 'All targets and the month-by-month log' : 'All daily targets'}
                <ChevronRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </Card>
        )}
        {activity.rows.length > 0 && (
          <Card className="p-4 md:p-6">
            <p className="text-sm font-medium text-text-primary mb-1">Moving, compared with before</p>
            <p className="text-[11px] text-text-secondary mb-3">
              {formatDayKeyLong(activity.recentFrom)} – {formatDayKeyLong(activity.recentTo)}, against {activity.beforeLabel}.
            </p>
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-3 font-medium">Daily average</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Before</th>
                  <th scope="col" className="py-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {activity.rows.map(r => (
                  <tr key={r.id} className="border-b border-border/50 text-text-primary">
                    <td className="py-2 pr-3">{r.label} <span className="text-[11px] text-text-secondary">({r.unit})</span></td>
                    <td className="py-2 pr-3 tnum">{fmt(r.id, r.before)}</td>
                    <td className="py-2 tnum">{fmt(r.id, r.recent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activity.rows.every(r => r.before === null || r.id === 'workouts') && (
              <div className="mt-3">
                <DataStateNote>There are no daily activity readings from {activity.beforeLabel} to compare with.</DataStateNote>
              </div>
            )}
            {report.effects.activeShare !== null && (
              <div className="mt-3">
                <DataStateNote>
                  Active energy is about {Math.round(report.effects.activeShare * 100)} % of your maintenance calories. Moving
                  more raises maintenance, so the same intake {report.phase.phase === 'bulk' ? 'gains more slowly' : 'loses faster'}.
                </DataStateNote>
              </div>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}

// ── How the body is responding ──────────────────────────

function ResponseSection({ report }: { report: BodyGoalReport }) {
  const items = [report.effects.rate, report.effects.lean].filter((i): i is NonNullable<typeof i> => i !== null);
  const recovery = report.effects.recovery;
  if (items.length === 0 && recovery.length === 0) return null;

  return (
    <section>
      <SectionTitle hint="shown when there is data for it">How your body is responding</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map(item => (
          <ResponseCard key={item.id} label={item.label} status={item.status} text={item.text} />
        ))}
        {recovery.map(i => (
          <ResponseCard key={i.signal} label={i.label} status={i.status} text={i.text} advice={i.goalAdvice} rule={i.rule} />
        ))}
      </div>
    </section>
  );
}

function ResponseCard({ label, status, text, advice, rule }: { label: string; status: EffectStatus | 'warn' | 'unknown'; text: string; advice?: string | null; rule?: string | null }) {
  const badge = STATUS_BADGE[status];
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">{text}</p>
      {advice && <p className="mt-2 text-sm text-text-primary leading-relaxed">{advice}</p>}
      {rule && <p className="mt-2 text-[11px] text-text-secondary">{rule}</p>}
    </Card>
  );
}
