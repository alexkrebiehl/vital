'use client';

// ── /workouts/routine ───────────────────────────────────
//
// The active training plan itself: its goal and background, the rhythm of
// training and rest days (the repeating pattern and this week), its workouts,
// and its structure — phases reached through progress, and calendar blocks.
// The Workouts page keeps what to train now; this page is the plan's shape.

import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquare, Repeat } from 'lucide-react';
import type { CadenceDay, CadenceNode, CadenceView } from '@/lib/routine/cadence';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { PhaseView } from '@/lib/routine/position';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useRoutineFetch, type RoutineApiResponse } from './shared';
import { analystHref, workoutHref } from './RoutineSection';

function BackLink() {
  return (
    <Link href="/workouts#routine" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Workouts</span>
    </Link>
  );
}

const SECTION_HEADING = 'text-sm font-semibold text-text-primary';

export function RoutinePlanPage() {
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<RoutineApiResponse>('/api/routine', units);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <BackLink />
        <Skeleton height={32} width="50%" />
        <Skeleton height={140} />
        <Skeleton height={180} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState title="The plan could not be loaded" message={state.message} onRetry={reload} />
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
            description="Create one from the Workouts page, or ask the analyst to build one."
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
      <PlanHeader routine={routine} />
      <Cadence cadence={routine.cadence} adherence={routine.adherence.text} />
      <Workouts routine={routine} />
      <Phases routine={routine} />
      <CalendarBlocks routine={routine} />
    </div>
  );
}

function PlanHeader({ routine }: { routine: RoutineOverview }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <p className="text-xs text-text-secondary">Training plan</p>
        <h1 className="text-[24px] md:text-[30px] font-semibold tracking-tight text-text-primary leading-tight mt-1">{routine.title}</h1>
        <p className="text-sm text-text-secondary mt-1">{routine.goal}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {routine.currentPhase ? (
            <Badge variant="accent">
              Phase {routine.currentPhase.index + 1} of {routine.currentPhase.count}: {routine.currentPhase.name}
            </Badge>
          ) : routine.phases.length > 0 ? (
            <Badge variant="success">All phases complete</Badge>
          ) : null}
          <Badge>{routine.started ? `Week ${routine.week} of ${routine.durationWeeks}` : `Starts ${formatDayKeyShort(routine.startDate)}`}</Badge>
          {routine.currentBlocks.map(b => (
            <Badge key={b}>{b}</Badge>
          ))}
          {(routine.deload.status === 'due' || routine.deload.status === 'overdue') && (
            <Badge variant="warning">{routine.deload.status === 'overdue' ? 'Deload overdue' : 'Deload due'}</Badge>
          )}
          {routine.deload.status === 'in-deload' && <Badge variant="info">Deload week</Badge>}
        </div>
        {routine.context.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs text-text-secondary list-disc pl-4">
            {routine.context.map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
      <Link href={analystHref(`Review my training plan "${routine.title}" and my recent progress.`)}>
        <Button size="sm">
          <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
          Discuss with analyst
        </Button>
      </Link>
    </header>
  );
}

// ── Cadence ─────────────────────────────────────────────

function Cadence({ cadence, adherence }: { cadence: CadenceView; adherence: string }) {
  return (
    <Card className="p-5 space-y-5" as="section" aria-labelledby="cadence-title">
      <div>
        <h2 id="cadence-title" className={SECTION_HEADING}>
          Cadence
        </h2>
        <p className="text-xs text-text-secondary mt-0.5">{cadence.caption}</p>
      </div>
      {cadence.pattern.length > 0 && <Pattern nodes={cadence.pattern} />}
      <WeekStrip days={cadence.week} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-accent-tint" aria-hidden="true" />
          Logged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-primary" aria-hidden="true" />
          Expected
        </span>
        {cadence.kind === 'frequency' && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-text-secondary" aria-hidden="true" />
            Any day
          </span>
        )}
        <span>
          {cadence.weekSummary}. {adherence}
        </span>
      </div>
    </Card>
  );
}

/** The repeating pattern: workouts as boxes, rest as pills, arrows between, and back to the start. */
function Pattern({ nodes }: { nodes: CadenceNode[] }) {
  return (
    // The Today/Next tag floats above its node, so every node and arrow shares one centre line.
    <ol className="flex flex-wrap items-center gap-y-7 pt-5 list-none p-0" aria-label="Repeating pattern">
      {nodes.map((node, i) => (
        <li key={i} className="inline-flex items-center">
          <div className="relative flex">
            {node.current && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary whitespace-nowrap">
                {node.current === 'today' ? 'Today' : 'Next'}
              </span>
            )}
            <PatternNode node={node} />
          </div>
          {i < nodes.length - 1 ? (
            <ArrowRight size={14} className="mx-1.5 text-text-secondary shrink-0" aria-hidden="true" />
          ) : (
            <span className="inline-flex items-center gap-1 ml-2 text-[11px] text-text-secondary">
              <Repeat size={13} aria-hidden="true" />
              back to start
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function PatternNode({ node }: { node: CadenceNode }) {
  const ring = node.current ? 'ring-2 ring-primary' : '';
  if (node.kind === 'rest') {
    return (
      <span className={`rounded-full bg-surface-muted px-3 py-1.5 text-xs text-text-secondary ${ring}`} title={node.note}>
        Rest
      </span>
    );
  }
  return (
    <span className={`rounded-control border border-border px-3 py-2 text-sm font-medium text-text-primary ${node.current ? 'bg-accent-tint' : 'bg-surface'} ${ring}`} title={node.note}>
      {node.templates.map((t, k) => (
        <Fragment key={t.id}>
          {k > 0 && ' + '}
          <Link href={workoutHref(t.id)} className="hover:underline underline-offset-2">
            {t.name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

/** Monday to Sunday: what was logged, and what the schedule expects for the days ahead. */
function WeekStrip({ days }: { days: CadenceDay[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-2">This week</h3>
      <ol className="grid grid-cols-7 gap-1 sm:gap-2 list-none p-0">
        {days.map(d => (
          <li key={d.date} aria-current={d.isToday ? 'date' : undefined} aria-label={dayLabel(d)} className="min-w-0 flex flex-col items-center gap-1">
            <span className={`text-[10px] sm:text-[11px] leading-none ${d.isToday ? 'font-semibold text-primary' : 'text-text-secondary'}`}>{d.weekday}</span>
            <span className={`text-[10px] leading-none tnum ${d.isToday ? 'font-semibold text-primary' : 'text-text-secondary'}`}>{Number(d.date.slice(8))}</span>
            <DayCell day={d} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function dayLabel(d: CadenceDay): string {
  const when = `${d.weekday} ${formatDayKeyShort(d.date)}${d.isToday ? ' (today)' : ''}`;
  if (d.logged.length) return `${when}: logged ${d.logged.map(t => t.name).join(', ')}`;
  if (d.otherSession) return `${when}: logged a session outside the plan's workouts`;
  if (d.rested) return `${when}: rest`;
  if (!d.expected) return when;
  if (d.expected.kind === 'rest') return `${when}: rest expected`;
  if (d.expected.kind === 'open') return `${when}: open`;
  return `${when}: ${d.expected.templates.map(t => t.name).join(' + ')} expected`;
}

function DayCell({ day }: { day: CadenceDay }) {
  const base = `w-full min-h-[56px] rounded-control p-1 flex flex-col items-center justify-center gap-0.5 text-center ${day.isToday ? 'ring-2 ring-primary' : ''}`;
  const names = (list: { id: string; name: string }[]) =>
    list.map(t => (
      <Link
        key={t.id}
        href={workoutHref(t.id)}
        title={t.name}
        className="block w-full text-[10px] sm:text-[11px] leading-tight text-text-primary line-clamp-2 break-words hover:underline underline-offset-2"
      >
        {t.name}
      </Link>
    ));

  if (day.logged.length) {
    return (
      <div className={`${base} bg-accent-tint`}>
        <Check size={12} className="text-primary shrink-0" aria-hidden="true" />
        {names(day.logged)}
      </div>
    );
  }
  if (day.otherSession) {
    return (
      <div className={`${base} bg-accent-tint text-[10px] sm:text-[11px] text-text-primary`} title="A logged session that matches none of the plan's workouts">
        <Check size={12} className="text-primary shrink-0" aria-hidden="true" />
        Session
      </div>
    );
  }
  if (day.rested) return <div className={`${base} bg-surface-muted text-[10px] sm:text-[11px] text-text-secondary`}>Rest</div>;
  const e = day.expected;
  if (!e) return <div className={`${base} border border-transparent`} />;
  if (e.kind === 'rest') return <div className={`${base} bg-surface-muted text-[10px] sm:text-[11px] text-text-secondary`}>Rest</div>;
  if (e.kind === 'open') return <div className={`${base} border border-dashed border-text-secondary`} />;
  return <div className={`${base} border border-primary`}>{names(e.templates)}</div>;
}

// ── Workouts ────────────────────────────────────────────

function Workouts({ routine }: { routine: RoutineOverview }) {
  if (routine.workouts.length === 0) return null;
  return (
    <section aria-labelledby="workouts-title">
      <h2 id="workouts-title" className={`${SECTION_HEADING} mb-3`}>
        Workouts
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {routine.workouts.map(w => {
          const ready = w.domains.flatMap(d => d.slots).filter(s => s.suggestion?.status === 'ready').length;
          return (
            <Link key={w.id} href={workoutHref(w.id)} className="block group">
              <Card className="p-4 h-full group-hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary group-hover:underline underline-offset-2">{w.name}</p>
                  {w.when && <Badge variant="accent">{w.when}</Badge>}
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {w.domains.map(d => d.areaName).join(' · ') || 'No slots yet'}
                  {w.minutes ? ` · ~${w.minutes} min` : ''}
                </p>
                {ready > 0 && <p className="text-[11px] text-text-secondary mt-2">{ready} ready to progress</p>}
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Phases and calendar blocks ──────────────────────────

// The current phase takes the logged-day fill from the cadence strip; completed
// phases sit on the card itself; upcoming ones stay muted.
const PHASE_SURFACE: Record<PhaseView['status'], string> = {
  current: 'bg-accent-tint',
  complete: '',
  upcoming: 'bg-surface-muted',
};

function Phases({ routine }: { routine: RoutineOverview }) {
  if (routine.phases.length === 0) return null;
  const current = routine.currentPhase;
  return (
    <Card className="p-5 scroll-mt-20" as="section" id="phases" aria-labelledby="phases-title">
      <h2 id="phases-title" className={SECTION_HEADING}>
        Phases
      </h2>
      <p className="text-[11px] text-text-secondary mt-0.5">
        {current
          ? `Phase ${current.index + 1}: ${current.name} — ${current.progress.met} of ${current.progress.total} milestones reached${current.since ? `, since ${current.since}` : ''}. Phases follow your progress, not the calendar.`
          : 'Every phase is complete.'}
      </p>
      <ol className="mt-3 space-y-3 list-none p-0">
        {routine.phases.map(p => (
          <li key={p.id} className={`rounded-control p-3 ${PHASE_SURFACE[p.status]}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={`text-sm ${p.status === 'upcoming' ? 'text-text-secondary' : 'text-text-primary'} font-medium`}>
                {p.index + 1}. {p.name}
              </p>
              <span className="text-[11px] text-text-secondary">
                {p.status === 'complete'
                  ? `Complete${p.completedOn ? ` · ${p.completedOn}` : ''}`
                  : p.status === 'current'
                    ? `Current · ${p.progress.met} of ${p.progress.total}`
                    : `Upcoming${p.expectedWeeks ? ` · typically ${p.expectedWeeks[0]}–${p.expectedWeeks[1]} weeks` : ''}`}
              </span>
            </div>
            {p.goals.length > 0 && <p className="text-[11px] text-text-secondary mt-0.5">{p.goals.join(' · ')}</p>}
            <ul className="mt-1.5 space-y-0.5">
              {p.targets.map(t => (
                <li key={t.label} className="text-xs text-text-secondary">
                  <span aria-hidden="true">{t.met === true ? '✓ ' : t.met === false ? '○ ' : '· '}</span>
                  <span className={t.met ? 'text-text-primary' : ''}>{t.label}</span>
                  {t.optional ? ' (optional)' : ''}
                  {t.met && t.metOn ? <span className="tnum"> · {t.metOn}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CalendarBlocks({ routine }: { routine: RoutineOverview }) {
  if (routine.blocks.length === 0) return null;
  const statusLabel = { past: 'Done', current: 'This week', future: 'Upcoming' } as const;
  return (
    <Card className="p-5 scroll-mt-20" as="section" id="blocks" aria-labelledby="blocks-title">
      <h2 id="blocks-title" className={SECTION_HEADING}>
        Calendar blocks
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-secondary border-b border-border">
              <th className="py-1.5 pr-3 font-medium">Block</th>
              <th className="py-1.5 pr-3 font-medium">Weeks</th>
              <th className="py-1.5 pr-3 font-medium">Goals</th>
              <th className="py-1.5 pr-3 font-medium">Targets</th>
              <th className="py-1.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {routine.blocks.map(b => (
              <tr key={b.id} className={`border-b border-border last:border-b-0 align-top ${b.status === 'current' ? 'bg-accent-tint' : ''}`}>
                <td className="py-2 pr-3 text-text-primary font-medium">{b.name}</td>
                <td className="py-2 pr-3 text-text-secondary tnum whitespace-nowrap">{b.weeks[0] === b.weeks[1] ? b.weeks[0] : `${b.weeks[0]}–${b.weeks[1]}`}</td>
                <td className="py-2 pr-3 text-text-secondary">{b.goals.join('; ')}</td>
                <td className="py-2 pr-3 text-text-secondary">
                  {b.targets.map(t => (
                    <span key={t.label} className="block">
                      {t.met === true ? '✓ ' : ''}
                      {t.label}
                    </span>
                  ))}
                </td>
                <td className="py-2 text-text-primary whitespace-nowrap">{statusLabel[b.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
