'use client';

// ── Routine section (top of /workouts) ──────────────────
//
// The active training plan at a glance: where the reader is in it, what session
// is next, each progression path's light and how close it is to its next stage,
// and whether recovery supports pushing. Every card opens the path's detail page.
//
// Works for any discipline and any schedule shape; nothing here assumes
// calisthenics, a lifting split or an A/B/rest cadence.

import Link from 'next/link';
import { useState } from 'react';
import { Archive, CalendarDays, ChevronDown, ChevronRight, MessageSquare, PauseCircle, Sparkles } from 'lucide-react';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { ScheduledDayView } from '@/lib/routine/schedule';
import { Badge, Button, Card, DataStateNote, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { SectionTitle } from '@/components/domain/DomainShared';
import { LightLabel, PlanChangeCard, useRoutineFetch, type RoutineApiResponse } from './shared';
import type { PlanChange } from '@/lib/routine/types';

const CREATE_PROMPT = 'Create a training plan for me. Ask me about my goal, schedule and equipment first.';

export function analystHref(question: string): string {
  return `/analyst?q=${encodeURIComponent(question)}`;
}

export function RoutineSection() {
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<RoutineApiResponse>('/api/routine', units);
  const [change, setChange] = useState<PlanChange | null>(null);

  return (
    <section id="routine" aria-labelledby="routine-title">
      <SectionTitle hint="Your training plan, judged against your logged sessions">
        <span id="routine-title">Routine</span>
      </SectionTitle>

      {state.status === 'loading' && (
        <Card className="p-5 space-y-3" aria-label="Loading the routine">
          <Skeleton height={18} width="40%" />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </Card>
      )}
      {state.status === 'error' && <ErrorState title="The routine could not be loaded" message={state.message} onRetry={reload} />}
      {state.status === 'ok' && (
        <>
          {change && (
            <div className="mb-4">
              <PlanChangeCard change={change} onUndone={() => { setChange(null); reload(); }} />
            </div>
          )}
          {state.data.routine ? (
            <RoutineBody data={state.data} routine={state.data.routine} onChange={c => { setChange(c); reload(); }} />
          ) : (
            <NoPlan data={state.data} onCreated={c => { setChange(c); reload(); }} />
          )}
        </>
      )}
    </section>
  );
}

function SourceNote({ data }: { data: RoutineApiResponse }) {
  const configured = data.sources.filter(s => s.configured || s.origin === 'demo');
  if (data.origin === 'demo') {
    return <DataStateNote>Demo mode: sessions come from committed demo training data shaped like a Hevy export.</DataStateNote>;
  }
  if (configured.length === 0) {
    return (
      <DataStateNote tone="attention">
        No workout source is connected, so sets, reps, load and effort are unknown. Apple Health workouts still count for
        plans matched by workout type (e.g. running). Connect Hevy with <code>HEVY_API_KEY</code> — see Settings → Connections.
      </DataStateNote>
    );
  }
  const failing = configured.filter(s => s.lastError);
  if (failing.length) {
    return <DataStateNote tone="attention">{failing.map(s => `${s.displayName}: ${s.lastError}`).join(' ')}</DataStateNote>;
  }
  return null;
}

function NoPlan({ data, onCreated }: { data: RoutineApiResponse; onCreated: (c: PlanChange) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-5 space-y-4">
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No training plan yet"
        description="Describe your goal to the analyst — any discipline, any schedule — and it will build a multi-month plan, then track each progression here against your logged sessions."
        action={
          <Link href={analystHref(CREATE_PROMPT)}>
            <Button variant="primary" size="sm">
              <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
              Create a plan with the analyst
            </Button>
          </Link>
        }
      />
      <div className="border-t border-border pt-4">
        <p className="text-xs text-text-secondary mb-2">
          Or start from an example and adjust it later. Paths are placed on the stage your recent sessions show.
        </p>
        <div className="flex flex-wrap gap-2">
          {data.references.map(ref => (
            <Button
              key={ref.id}
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(ref.id);
                setError(null);
                const res = await fetch('/api/routine', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'start-reference', reference: ref.id }),
                });
                const body = (await res.json().catch(() => ({}))) as { change?: PlanChange; error?: string };
                setBusy(null);
                if (!res.ok || !body.change) setError(body.error ?? `HTTP ${res.status}`);
                else onCreated(body.change);
              }}
            >
              {busy === ref.id ? 'Starting…' : ref.label}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-category-attention mt-2">{error}</p>}
      </div>
      <SourceNote data={data} />
    </Card>
  );
}

function RoutineBody({ data, routine, onChange }: { data: RoutineApiResponse; routine: RoutineOverview; onChange: (c: PlanChange) => void }) {
  const areas = [...new Set(routine.paths.map(p => p.areaId))].map(id => ({
    id,
    name: routine.paths.find(p => p.areaId === id)!.areaName,
    paths: routine.paths.filter(p => p.areaId === id),
  }));
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">{routine.title}</h3>
            <p className="text-xs text-text-secondary mt-0.5 max-w-2xl">{routine.goal}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="accent">
                {routine.started ? `Week ${routine.week} of ${routine.durationWeeks}` : `Starts ${routine.startDate}`}
              </Badge>
              {routine.currentBlocks.map(b => (
                <Badge key={b}>{b}</Badge>
              ))}
              <RecoveryChip routine={routine} />
              {(routine.deload.status === 'due' || routine.deload.status === 'overdue') && (
                <Badge variant="warning">{routine.deload.status === 'overdue' ? 'Deload overdue' : 'Deload due'}</Badge>
              )}
              {routine.deload.status === 'in-deload' && <Badge variant="info">Deload week</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={analystHref(`Review my training plan "${routine.title}" and my recent progress.`)}>
              <Button size="sm">
                <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
                Discuss with analyst
              </Button>
            </Link>
            <ArchiveButton onChange={onChange} />
          </div>
        </div>
        <NextSession routine={routine} />
      </Card>

      {areas.map(area => (
        <div key={area.id}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">{area.name}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {area.paths.map(p => (
              <PathCard key={p.pathId} path={p} />
            ))}
          </div>
        </div>
      ))}

      <PlanPosition routine={routine} />
      <SourceNote data={data} />
    </div>
  );
}

function RecoveryChip({ routine }: { routine: RoutineOverview }) {
  const r = routine.recovery;
  const variant = r.status === 'warn' ? 'warning' : r.status === 'watch' ? 'info' : r.status === 'ok' ? 'success' : 'default';
  const label = r.status === 'warn' ? 'Recovery: hold' : r.status === 'watch' ? 'Recovery: watch' : r.status === 'ok' ? 'Recovery: ok' : 'Recovery: unknown';
  return (
    <span title={r.text}>
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}

function ArchiveButton({ onChange }: { onChange: (c: PlanChange) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label="Archive this plan">
        <Archive size={14} aria-hidden="true" />
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          const res = await fetch('/api/routine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }) });
          const body = (await res.json().catch(() => ({}))) as { change?: PlanChange };
          setConfirming(false);
          if (body.change) onChange(body.change);
        }}
      >
        Archive plan
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

function DayTemplates({ day }: { day: ScheduledDayView }) {
  if (day.kind === 'rest') return <p className="text-sm text-text-secondary">Rest{day.note ? ` — ${day.note}` : ''}.</p>;
  return (
    <div className="space-y-2">
      {day.templates.map(t => (
        <div key={t.id}>
          <p className="text-sm font-medium text-text-primary">
            {t.name}
            {t.minutes ? <span className="text-text-secondary font-normal"> · ~{t.minutes} min</span> : null}
          </p>
          <ul className="mt-1 space-y-0.5">
            {t.slots.map(s => (
              <li key={`${t.id}-${s.pathId}`} className="text-xs text-text-secondary">
                <span className="text-text-primary">{s.stageName}</span>
                {s.dose ? ` — ${s.dose}` : ''}
                {s.optional ? ' (optional)' : ''}
                {s.rotatesWith.length > 0 && s.optional ? ' · rotates' : ''}
              </li>
            ))}
          </ul>
          {t.warmup.length > 0 && <p className="text-[11px] text-text-secondary mt-1">Warm-up: {t.warmup.join(', ')}</p>}
        </div>
      ))}
    </div>
  );
}

function NextSession({ routine }: { routine: RoutineOverview }) {
  const next = routine.next;
  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 rounded-control bg-surface-muted p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1 flex items-center gap-1.5">
          <CalendarDays size={12} aria-hidden="true" />
          {next.doneToday ? 'Next session' : 'Today'}
        </p>
        <DayTemplates day={next.due} />
        <p className="text-[11px] text-text-secondary mt-2">{next.why} {routine.adherence.text}</p>
      </div>
      {next.upcoming.length > 0 && (
        <div className="text-xs text-text-secondary lg:border-l lg:border-border lg:pl-4">
          <p className="font-semibold uppercase tracking-wide text-[11px] mb-1">Then</p>
          <ol className="space-y-0.5">
            {next.upcoming.map((d, i) => (
              <li key={i}>{d.label}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function PathCard({ path }: { path: PathProgress }) {
  const readiness = path.readiness;
  const pct = readiness ? Math.min(100, Math.round((readiness.qualifying / Math.max(1, readiness.needed)) * 100)) : 0;
  return (
    <Link href={`/workouts/routine/${path.pathId}`} className="block group">
      <Card className="p-4 h-full group-hover:shadow-sm transition-shadow">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-text-secondary">{path.pathName}{path.priority === 'secondary' ? ' · secondary' : ''}</p>
            <p className="text-sm font-semibold text-text-primary truncate">
              {path.stage.name}
              {path.step ? <span className="font-normal text-text-secondary"> · {path.step.name}</span> : null}
            </p>
          </div>
          <ChevronRight size={16} className="text-text-secondary shrink-0 mt-1" aria-hidden="true" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <LightLabel light={path.light} />
          {path.hold && (
            <Badge variant="warning">
              <PauseCircle size={11} className="mr-1" aria-hidden="true" />
              {path.hold.kind === 'regress' ? 'Regress' : 'On hold'}
            </Badge>
          )}
        </div>
        {readiness && (
          <div className="mt-3">
            <div className="flex justify-between text-[11px] text-text-secondary mb-1">
              <span>
                {path.stage.name}
                {path.nextStage ? ` → ${path.nextStage.name}` : ''}
              </span>
              <span className="tnum">{readiness.label}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={readiness.needed} aria-valuenow={readiness.qualifying} aria-label={`Progress toward ${path.nextStage?.name ?? 'the marker'}`}>
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <p className="text-xs text-text-secondary mt-3 line-clamp-2">
          {path.lastSession ? <>Last: <span className="text-text-primary">{path.lastSession.work}</span> ({path.lastSession.date}). </> : null}
          {path.nextAction}
        </p>
      </Card>
    </Link>
  );
}

function PlanPosition({ routine }: { routine: RoutineOverview }) {
  const [open, setOpen] = useState(false);
  if (routine.blocks.length === 0) return null;
  const statusLabel = { complete: 'Complete', behind: 'Behind', elapsed: 'Elapsed', current: 'Current', future: 'Future' } as const;
  return (
    <Card className="p-4">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="text-sm font-semibold text-text-primary">Plan position</span>
        <ChevronDown size={16} className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Block</th>
                <th className="py-1.5 pr-3 font-medium">Weeks</th>
                <th className="py-1.5 pr-3 font-medium">Goals</th>
                <th className="py-1.5 pr-3 font-medium">Targets</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {routine.blocks.map(b => (
                <tr key={b.id} className={`border-b border-border last:border-b-0 align-top ${b.status === 'current' ? 'bg-accent-tint/40' : ''}`}>
                  <td className="py-2 pr-3 text-text-primary font-medium">{b.name}</td>
                  <td className="py-2 pr-3 text-text-secondary tnum whitespace-nowrap">{b.weeks[0] === b.weeks[1] ? b.weeks[0] : `${b.weeks[0]}–${b.weeks[1]}`}</td>
                  <td className="py-2 pr-3 text-text-secondary">{b.goals.join('; ')}</td>
                  <td className="py-2 pr-3 text-text-secondary">
                    {b.targets.map(t => (
                      <span key={t.label} className="block">
                        {t.met === true ? '✓ ' : t.met === false ? '○ ' : ''}
                        {t.label}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 text-text-primary whitespace-nowrap">{statusLabel[b.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-text-secondary mt-2">✓ reached in a logged session since the block began · ○ not yet reached.</p>
        </div>
      )}
    </Card>
  );
}
