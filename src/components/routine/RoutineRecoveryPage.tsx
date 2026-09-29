'use client';

// ── /workouts/recovery ──────────────────────────────────
//
// Why the routine's recovery and deload badges say what they say, and what to
// do about it: what the current status does to progression and which paths it
// holds back, where the plan's deload rule stands, and every recovery signal
// with the readings behind it, the plan's limit for it and what helps.
//
// Nothing here assumes a discipline: the signals are the plan's recovery gates
// read from Apple Health and the logged sessions.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { RecoveryIndicator } from '@/lib/routine/recovery';
import type { RecoverySignalId } from '@/lib/routine/types';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { LightLabel, RECOVERY_TONE, pathHref, planHref, recoveryVariant, useRoutineFetch, type RoutineApiResponse } from './shared';
import { recoverySuggestions } from './discuss-suggestions';

function BackLink() {
  return (
    <Link href="/workouts#routine" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Workouts</span>
    </Link>
  );
}

const SECTION_HEADING = 'text-sm font-semibold text-text-primary';

export function RoutineRecoveryPage() {
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<RoutineApiResponse>('/api/routine', units);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <BackLink />
        <Skeleton height={32} width="40%" />
        <Skeleton height={120} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState title="Recovery could not be loaded" message={state.message} onRetry={reload} />
      </div>
    );
  }
  const routine = state.data.routine;
  if (!routine) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card className="p-5">
          <EmptyState
            title="No active plan"
            description="Recovery is judged against a training plan's limits. Create one from the Workouts page, or ask the analyst to build one."
            action={
              <Link href="/workouts#routine">
                <Button size="sm">Back to Workouts</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="text-xs text-text-secondary">
            <Link href={planHref} className="hover:text-text-primary hover:underline underline-offset-2">
              {routine.title}
            </Link>
          </p>
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-tight text-text-primary leading-tight mt-1">Recovery</h1>
          <p className="text-sm text-text-secondary mt-1">
            Whether your body supports pushing on, judged against the plan&apos;s limits, and when the next lighter week is due.
          </p>
        </div>
        <DiscussButton context={{ kind: 'routine' }} subject="recovery and deloads" suggestions={recoverySuggestions(routine)} onPlanChange={reload} />
      </header>
      <Now routine={routine} />
      <Deload routine={routine} />
      <Signals indicators={routine.recovery.indicators} />
    </div>
  );
}

// ── What the status means now ───────────────────────────

const HEADLINE: Record<RoutineOverview['recovery']['status'], string> = {
  warn: 'Progression is paused',
  watch: 'Progress with care',
  ok: 'Recovery is not holding anything back',
  unknown: 'Not enough recent data to check recovery',
};

function meaning(routine: RoutineOverview): string {
  const gated = routine.recovery.indicators.some(i => i.gate);
  if (!gated) return 'This plan sets no recovery limits, so the signals below are for information only and never hold a path back. Ask the analyst to add some — for example, hold progression if resting heart rate rises 5 bpm above your usual level.';
  switch (routine.recovery.status) {
    case 'warn':
      return 'A signal the plan treats as a reason to hold is outside its limit. Every path’s light is capped at yellow: keep training, but paths that would move on repeat their current dose instead. Progression resumes by itself once the signal is back inside the limit.';
    case 'watch':
      return 'A signal the plan watches has moved outside its limit. Lights are capped at yellow-green: train as planned, but no path moves on to its next stage until the signal settles.';
    case 'ok':
      return 'Every signal the plan checks is inside its limits, so paths move on as soon as their performance says so.';
    case 'unknown':
      return 'None of the signals the plan checks has enough recent readings, so nothing is held back. Readings come from Apple Health; wear your watch overnight and weigh in regularly to have them checked.';
  }
}

function Now({ routine }: { routine: RoutineOverview }) {
  const r = routine.recovery;
  const tripped = r.indicators.filter(i => i.status === 'warn' || i.status === 'watch');
  const held = routine.paths.filter(p => p.heldBack.includes('recovery'));
  return (
    <Card className="p-5 space-y-4 scroll-mt-20" as="section" id="now" aria-labelledby="now-title">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="now-title" className={SECTION_HEADING}>
            {HEADLINE[r.status]}
          </h2>
          <Badge variant={recoveryVariant(r.status)}>{RECOVERY_TONE[r.status]}</Badge>
        </div>
        <p className="text-xs text-text-secondary mt-1 max-w-3xl">{meaning(routine)}</p>
      </div>

      {tripped.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1.5">Why</h3>
          <ul className="space-y-1 list-none p-0">
            {tripped.map(i => (
              <li key={i.signal} className="text-xs text-text-secondary">
                <a href={`#signal-${i.signal}`} className="font-medium text-text-primary hover:underline underline-offset-2">
                  {i.label}
                </a>{' '}
                ({RECOVERY_TONE[i.status].toLowerCase()}): {i.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {held.length > 0 ? (
        <HeldPaths title="Paths held back by recovery" paths={held} />
      ) : (
        tripped.length > 0 && <p className="text-xs text-text-secondary">No path’s light is being lowered by recovery right now.</p>
      )}
    </Card>
  );
}

function HeldPaths({ title, paths }: { title: string; paths: RoutineOverview['paths'] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1.5">{title}</h3>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 list-none p-0">
        {paths.map(p => (
          <li key={p.pathId}>
            <Link href={pathHref(p.pathId)} className="flex items-start justify-between gap-2 rounded-control bg-surface-muted p-3 hover:bg-accent-tint transition-colors">
              <span className="min-w-0">
                <span className="block text-xs text-text-secondary">{p.pathName}</span>
                <span className="block text-sm font-medium text-text-primary truncate">{p.stage.name}</span>
                <span className="block mt-1">
                  <LightLabel light={p.light} tracked={p.tracked} />
                </span>
              </span>
              <ChevronRight size={16} className="text-text-secondary shrink-0 mt-1" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Deload ──────────────────────────────────────────────

const DELOAD_BADGE: Record<RoutineOverview['deload']['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  none: { label: 'No rule', variant: 'default' },
  ok: { label: 'Not due yet', variant: 'success' },
  due: { label: 'Due', variant: 'warning' },
  overdue: { label: 'Overdue', variant: 'warning' },
  'in-deload': { label: 'This week', variant: 'info' },
};

const pct = (range: [number, number]) => `${Math.round(range[0] * 100)}–${Math.round(range[1] * 100)}%`;

function deloadAdvice(d: RoutineOverview['deload']): string {
  const cut = d.rule ? `cut sets by ${pct(d.rule.volumeReduction)}` : 'cut sets by a third to a half';
  switch (d.status) {
    case 'overdue':
      return `Take a deload week now: keep every path on its current stage, ${cut}, and keep the effort easy. Progress picks up again the week after. Tell the analyst when you start, so it is recorded and the count restarts.`;
    case 'due':
      return `Plan a deload within the next week or two — sooner if the recovery signals below slip. During it, keep every path on its current stage and ${cut}. Tell the analyst when you start, so it is recorded.`;
    case 'in-deload':
      return `Keep every path on its current stage, ${cut}, and don’t chase progress this week. Paths pick up where they left off after it.`;
    case 'ok':
      return 'Nothing to do yet: keep training as planned.';
    case 'none':
      return 'This plan has no deload rule, so lighter weeks are never flagged. Ask the analyst to add one if you want them planned in.';
  }
}

function Deload({ routine }: { routine: RoutineOverview }) {
  const d = routine.deload;
  const badge = DELOAD_BADGE[d.status];
  const waiting = routine.paths.filter(p => p.heldBack.includes('deload'));
  return (
    <Card className="p-5 space-y-3 scroll-mt-20" as="section" id="deload" aria-labelledby="deload-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="deload-title" className={SECTION_HEADING}>
          Deload
        </h2>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-xs text-text-secondary max-w-3xl">{d.text}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Fact label={d.lastDeload ? 'Last deload' : 'Counting from'}>{formatDayKeyShort(d.lastDeload ?? routine.startDate)}</Fact>
        <Fact label="Weeks since">{d.status === 'in-deload' ? 'Deload week' : d.weeksSince}</Fact>
        <Fact label="Plan rule">{d.rule ? `Every ${d.rule.everyWeeks[0]}–${d.rule.everyWeeks[1]} weeks, sets cut ${pct(d.rule.volumeReduction)}` : 'None'}</Fact>
      </dl>
      <p className="text-xs text-text-primary max-w-3xl">{deloadAdvice(d)}</p>
      {waiting.length > 0 && <HeldPaths title="Ready to move on after the deload" paths={waiting} />}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-control bg-surface-muted p-3">
      <dt className="text-[11px] text-text-secondary">{label}</dt>
      <dd className="text-sm font-medium text-text-primary tnum mt-0.5">{children}</dd>
    </div>
  );
}

// ── Signals ─────────────────────────────────────────────

const FULL_DATA: Record<RecoverySignalId, { href: string; label: string }> = {
  resting_hr: { href: '/metric/resting_heart_rate', label: 'All resting heart rate readings' },
  hrv: { href: '/metric/heart_rate_variability', label: 'All HRV readings' },
  sleep_hours: { href: '/metric/sleep_analysis', label: 'All sleep' },
  body_weight_rate: { href: '/metric/weight_body_mass', label: 'All weigh-ins' },
  training_load: { href: '/workouts/all', label: 'All sessions' },
};

function Signals({ indicators }: { indicators: RecoveryIndicator[] }) {
  return (
    <section className="scroll-mt-20" id="signals" aria-labelledby="signals-title">
      <h2 id="signals-title" className={SECTION_HEADING}>
        Signals
      </h2>
      <p className="text-[11px] text-text-secondary mt-0.5 mb-3">
        The last 7 days against the 4 weeks before them, from Apple Health and your logged sessions.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {indicators.map(i => (
          <SignalCard key={i.signal} indicator={i} />
        ))}
      </div>
    </section>
  );
}

/** The unit of one reading (the indicator's own unit is a rate for weight and load). */
function pointUnit(i: RecoveryIndicator): string {
  if (i.signal === 'body_weight_rate') return i.unit.replace('/week', '');
  if (i.signal === 'training_load') return 'sessions';
  return i.unit;
}

function headline(i: RecoveryIndicator): string {
  if (i.current === null) return '—';
  if (i.signal === 'body_weight_rate') return `${i.current > 0 ? '+' : ''}${i.current}`;
  return String(i.current);
}

function SignalCard({ indicator: i }: { indicator: RecoveryIndicator }) {
  const full = FULL_DATA[i.signal];
  return (
    <Card className="p-4 flex flex-col gap-3 scroll-mt-20" as="article" id={`signal-${i.signal}`} aria-labelledby={`signal-${i.signal}-title`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`signal-${i.signal}-title`} className="text-sm font-medium text-text-primary">
            {i.label}
          </h3>
          <p className="mt-1">
            <span className="text-[22px] font-semibold text-text-primary tnum leading-none">{headline(i)}</span>
            {i.current !== null && <span className="text-xs text-text-secondary"> {i.unit}</span>}
            {i.baseline !== null && (
              <span className="text-xs text-text-secondary tnum">
                {' '}
                · usually {i.baseline}
              </span>
            )}
          </p>
        </div>
        <Badge variant={recoveryVariant(i.status)}>{RECOVERY_TONE[i.status]}</Badge>
      </div>
      <p className="text-[11px] text-text-secondary">{i.text}</p>
      <RecoveryTrend indicator={i} />
      <p className="text-[11px] text-text-secondary">
        <span className="font-medium text-text-primary">Plan limit: </span>
        {i.rule ?? 'none — shown for information, never holds a path back.'}
        {i.gate?.note && <span className="italic"> {i.gate.note}</span>}
      </p>
      {i.advice && <p className="text-xs text-text-primary rounded-control bg-surface-muted p-3">{i.advice}</p>}
      <Link href={full.href} className="mt-auto inline-flex items-center self-start text-xs text-text-secondary hover:text-text-primary hover:underline underline-offset-2">
        {full.label}
        <ChevronRight size={12} aria-hidden="true" />
      </Link>
    </Card>
  );
}

// ── Trend chart ─────────────────────────────────────────

/** The plan's limit as a level on the chart, where the gate can be drawn as one. */
function limitLevel(i: RecoveryIndicator): number | null {
  const level = rawLimit(i);
  return level === null ? null : Math.round(level * 10) / 10;
}

function rawLimit(i: RecoveryIndicator): number | null {
  const g = i.gate;
  if (!g) return null;
  const t = g.threshold ?? 0;
  switch (i.signal) {
    case 'resting_hr':
    case 'hrv':
      if (g.rule === 'below' || g.rule === 'above') return t;
      if (i.baseline === null) return null;
      return g.rule === 'rising' ? i.baseline + t : i.baseline - t;
    case 'sleep_hours':
      return g.rule === 'below' || g.rule === 'above' ? t : null;
    case 'training_load':
      // The gate is a % change on the weekly average.
      if (i.baseline === null || i.baseline <= 0) return null;
      return i.baseline * (1 + (g.rule === 'falling' ? -t : t) / 100);
    case 'body_weight_rate':
      // A rate: not a level the weigh-ins can be drawn against.
      return null;
  }
}

function TrendTooltip({ active, payload, weekly, unit }: { active?: boolean; payload?: { payload: { date: string; value: number } }[]; weekly: boolean; unit: string }) {
  const point = active && payload?.length ? payload[0].payload : null;
  if (!point) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <div className="text-text-secondary text-xs mb-1">{weekly ? `Week from ${formatDayKeyLong(point.date)}` : formatDayKeyLong(point.date)}</div>
      <div className="font-medium tnum text-text-primary">
        {point.value} {unit}
      </div>
    </div>
  );
}

function RecoveryTrend({ indicator: i }: { indicator: RecoveryIndicator }) {
  const data = i.points.map(p => ({ date: p.key, value: p.value }));
  const weekly = i.signal === 'training_load';
  if (data.length < 2 || (weekly && data.every(d => d.value === 0))) {
    return <p className="text-[11px] text-text-secondary rounded-control bg-surface-muted p-3">Not enough readings to draw a trend.</p>;
  }
  const unit = pointUnit(i);
  const hasBaselineWindow = data[0].date < i.recentFrom;
  const recentStart = data.find(d => d.date >= i.recentFrom)?.date ?? null;
  const limit = limitLevel(i);
  // The usual level and the plan's limit stay in view even when the readings never reach them.
  const levels = [...data.map(d => d.value), ...(i.baseline !== null ? [i.baseline] : []), ...(limit !== null ? [limit] : [])];
  const pad = (Math.max(...levels) - Math.min(...levels)) * 0.08 || 1;
  const domain: [number, number] = weekly
    ? [0, Math.ceil(Math.max(...levels))]
    : [Math.floor(Math.min(...levels) - pad), Math.ceil(Math.max(...levels) + pad)];
  const axis = { tick: { fontSize: 10, fill: 'var(--color-text-secondary)' }, tickLine: false as const, axisLine: false as const };
  const summary = `${i.label}: ${data.length} ${weekly ? 'weeks' : 'readings'} from ${formatDayKeyLong(data[0].date)} to ${formatDayKeyLong(data[data.length - 1].date)}, ranging ${Math.min(...data.map(d => d.value))} to ${Math.max(...data.map(d => d.value))} ${unit}.`;

  // An array, not a fragment: recharts reads its children with react-is 18,
  // which does not recognise React 19 fragments, and drops what is inside one.
  const references = [
    hasBaselineWindow && recentStart && (
      <ReferenceArea key="recent" x1={recentStart} x2={data[data.length - 1].date} fill="var(--color-accent)" fillOpacity={0.12} stroke="none" />
    ),
    i.baseline !== null && (
      <ReferenceLine key="usual" y={i.baseline} stroke="var(--color-text-secondary)" strokeDasharray="4 4" strokeWidth={1} />
    ),
    limit !== null && <ReferenceLine key="limit" y={limit} stroke="var(--color-category-attention)" strokeWidth={1.5} />,
  ];
  const common = {
    grid: <CartesianGrid stroke="var(--color-border)" vertical={false} />,
    x: <XAxis {...axis} dataKey="date" minTickGap={32} interval="preserveStartEnd" tickFormatter={(v: string) => formatDayKeyShort(v)} />,
    y: <YAxis {...axis} width={32} domain={domain} tickCount={3} allowDecimals={i.signal !== 'training_load'} />,
    tooltip: <Tooltip cursor={{ stroke: 'var(--color-border)' }} content={<TrendTooltip weekly={weekly} unit={unit} />} />,
  };

  return (
    <figure className="m-0">
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={120}>
          {weekly ? (
            <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              {common.grid}
              {common.x}
              {common.y}
              <Tooltip cursor={{ fill: 'var(--color-surface-muted)' }} content={<TrendTooltip weekly unit={unit} />} />
              {references}
              <Bar dataKey="value" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              {common.grid}
              {common.x}
              {common.y}
              {common.tooltip}
              {references}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill="var(--color-accent)"
                fillOpacity={0.1}
                dot={i.signal === 'body_weight_rate' ? { r: 3, fill: 'var(--color-accent)', strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-text-secondary">
        {hasBaselineWindow && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-2.5 rounded-sm bg-accent-tint" aria-hidden="true" />
            {weekly ? 'This week' : 'Last 7 days'}
          </span>
        )}
        {i.baseline !== null && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-text-secondary" aria-hidden="true" />
            Usual ({i.baseline})
          </span>
        )}
        {limit !== null && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 border-t-2 border-category-attention" aria-hidden="true" />
            {weekly ? 'Plan limit' : 'Limit for the 7-day average'} ({limit})
          </span>
        )}
        <span className="ml-auto tnum">y-axis: {unit}</span>
      </figcaption>
    </figure>
  );
}
