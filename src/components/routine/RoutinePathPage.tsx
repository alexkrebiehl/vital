'use client';

// ── /workouts/routine/[pathId] ──────────────────────────
//
// One progression path in detail: which stage it is on and what comes next, the
// recent sessions with what each one signals, the light with its reasons, the
// next action, the stage's cues and checks, and the recovery indicators that can
// hold progression back.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle2, Circle, CircleDot, MessageSquare, PauseCircle } from 'lucide-react';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { RecoveryIndicator } from '@/lib/routine/recovery';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { Badge, Button, Card, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { LightDot, LightLabel, useRoutineFetch } from './shared';
import { analystHref } from './RoutineSection';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import type { NarrativeView } from '@/lib/routine/narrative-types';

interface PathDetailResponse {
  routine: RoutineOverview;
  path: PathProgress;
  narrative?: NarrativeView;
  sources: WorkoutSourceStatus[];
  origin: 'live' | 'demo';
}

function BackLink() {
  return (
    <Link href="/workouts#routine" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Workouts</span>
    </Link>
  );
}

export function RoutinePathPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<PathDetailResponse>(`/api/routine/${encodeURIComponent(pathId)}`, units);

  // A model note is written in the background: poll a few times, backing off.
  const polls = useRef(0);
  const pending = state.status === 'ok' && state.data.narrative?.pending === true;
  useEffect(() => {
    if (!pending || polls.current >= 6) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      reload();
    }, 3000 * 2 ** polls.current);
    return () => clearTimeout(timer);
  }, [pending, state, reload]);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <BackLink />
        <Skeleton height={32} width="50%" />
        <Skeleton height={180} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState title="This path could not be loaded" message={state.message} onRetry={reload} />
      </div>
    );
  }
  const { path, routine, narrative } = state.data;
  const stageNumber = path.stage.index + 1;

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-text-secondary">
            {routine.title} · {path.areaName} · {path.pathName}
          </p>
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-tight text-text-primary leading-tight mt-1">
            Current stage: {stageNumber > 1 || path.stages.length > 1 ? `Stage ${stageNumber} ` : ''}
            {path.stage.name.toLowerCase()}
            {path.step ? ` · ${path.step.name}` : ''}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge>{path.modelLabel}</Badge>
            {path.stage.startedOn && <Badge>Since {path.stage.startedOn}</Badge>}
            {path.nextStage && <Badge variant="accent">Next: {path.nextStage.name}</Badge>}
          </div>
        </div>
        <Link href={analystHref(`How is my ${path.pathName.toLowerCase()} progression going, and what should I do next?`)}>
          <Button size="sm">
            <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
            Discuss with analyst
          </Button>
        </Link>
      </header>

      {path.hold && (
        <DataStateNote tone="attention">
          <span className="inline-flex items-center gap-1.5">
            <PauseCircle size={14} aria-hidden="true" />
            {path.hold.kind === 'regress' ? 'Regress' : 'On hold'} since {path.hold.since}: {path.hold.reason}. Ask the analyst to clear it when it has resolved.
          </span>
        </DataStateNote>
      )}

      <Assessment path={path} narrative={narrative} />
      <SessionTable path={path} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageMap path={path} />
        <StageGuidance path={path} routine={routine} />
      </div>

      <Recovery indicators={routine.recovery.indicators} summary={routine.recovery.text} deload={routine.deload.text} />
    </div>
  );
}

function Assessment({ path, narrative }: { path: PathProgress; narrative?: NarrativeView }) {
  const text = narrative?.assessment ?? path.reasons.join(' ');
  const next = narrative?.nextAction ?? path.nextAction;
  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-text-primary inline-flex items-center gap-2">
          <LightDot light={path.light} size={12} />
          Light:
        </span>
        <LightLabel light={path.light} />
        {path.readiness && <span className="text-xs text-text-secondary tnum">{path.readiness.label}</span>}
      </div>
      <p className="text-sm text-text-primary leading-relaxed">{text}</p>
      <p className="text-sm text-text-primary leading-relaxed">
        <span className="font-semibold">Next action:</span> {next}
      </p>
      {narrative && (
        <p className="text-[11px] text-text-secondary">
          {narrative.source === 'model'
            ? `Written by ${narrative.model ?? 'the configured model'} from the computed figures; every number was checked against them.`
            : narrative.note}
        </p>
      )}
    </Card>
  );
}

function SessionTable({ path }: { path: PathProgress }) {
  if (path.rows.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-text-secondary">
          No sessions logged for {path.stage.name.toLowerCase()} yet. Sessions are matched by exercise name or template id from your workout
          source (or by Apple Health workout type).
        </p>
      </Card>
    );
  }
  const rows = path.rows.slice(-10);
  return (
    <Card className="p-5 overflow-x-auto" as="section" aria-label="Recent sessions">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-secondary border-b border-border">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Work</th>
            <th className="py-2 pr-4 font-medium text-right">{path.model === 'volume' ? 'Sessions' : path.model === 'load' || path.model === 'percentage' ? 'Estimate' : 'Total'}</th>
            <th className="py-2 pr-4 font-medium">Effort</th>
            <th className="py-2 font-medium">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.sessionIds.join(',') || r.dates.join(',')} className={`border-b border-border last:border-b-0 align-top ${r.stageId !== path.stage.id ? 'text-text-secondary' : ''}`}>
              <td className="py-2 pr-4 whitespace-nowrap tnum">{r.dates.map(formatDayKeyShort).join(' / ')}</td>
              <td className="py-2 pr-4">
                {r.work}
                {r.notes && <span className="block text-[11px] text-text-secondary italic">{r.notes}</span>}
              </td>
              <td className="py-2 pr-4 text-right tnum whitespace-nowrap">{r.headline}</td>
              <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">{r.effort ?? '—'}</td>
              <td className="py-2">{r.signal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {path.rows.length > rows.length && <p className="text-[11px] text-text-secondary mt-2">Showing the latest {rows.length} of {path.rows.length} rows.</p>}
    </Card>
  );
}

function StageMap({ path }: { path: PathProgress }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Stages</h2>
      <ol className="space-y-2">
        {path.stages.map(s => (
          <li key={s.id} className="flex items-start gap-2">
            {s.status === 'done' ? (
              <CheckCircle2 size={16} className="text-category-activity mt-0.5 shrink-0" aria-label="Done" />
            ) : s.status === 'current' ? (
              <CircleDot size={16} className="text-primary mt-0.5 shrink-0" aria-label="Current" />
            ) : (
              <Circle size={16} className="text-text-secondary mt-0.5 shrink-0" aria-label="Upcoming" />
            )}
            <div className="min-w-0">
              <p className={`text-sm ${s.status === 'current' ? 'font-semibold text-text-primary' : s.status === 'done' ? 'text-text-secondary' : 'text-text-primary'}`}>
                {s.name}
                {s.expectedWeeks && <span className="text-[11px] font-normal text-text-secondary"> · {s.expectedWeeks[0]}–{s.expectedWeeks[1]} weeks</span>}
              </p>
              {s.target && <p className="text-[11px] text-text-secondary">Move on at {s.target}{s.startedOn ? ` · since ${s.startedOn}` : ''}</p>}
              {s.steps.length > 0 && <p className="text-[11px] text-text-secondary">Steps: {s.steps.join(' → ')}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StageGuidance({ path, routine }: { path: PathProgress; routine: RoutineOverview }) {
  return (
    <Card className="p-5 space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">{path.stage.name}</h2>
      {path.prescription && (
        <p className="text-xs text-text-secondary">
          <span className="text-text-primary font-medium">Prescription:</span> {path.prescription}
        </p>
      )}
      {path.target && (
        <p className="text-xs text-text-secondary">
          <span className="text-text-primary font-medium">Progression marker:</span> {path.target}
        </p>
      )}
      {path.cues.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-primary">Cues</p>
          <ul className="text-xs text-text-secondary list-disc pl-4">{path.cues.map(c => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {(path.checks.length > 0 || routine.doNotProgressIf.length > 0) && (
        <div>
          <p className="text-xs font-medium text-text-primary">Check before progressing</p>
          <p className="text-[11px] text-text-secondary mb-1">These can&apos;t be read from any data source — only you can judge them.</p>
          <ul className="text-xs text-text-secondary list-disc pl-4">
            {[...path.checks, ...routine.doNotProgressIf.map(d => `Don't progress if: ${d.charAt(0).toLowerCase()}${d.slice(1)}`)].map(c => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Recovery({ indicators, summary, deload }: { indicators: RecoveryIndicator[]; summary: string; deload: string }) {
  const tone = { ok: 'Inside limits', watch: 'Watch', warn: 'Hold', info: 'For information', unknown: 'Not enough data' } as const;
  return (
    <Card className="p-5" as="section" aria-label="Recovery indicators">
      <h2 className="text-sm font-semibold text-text-primary">Recovery</h2>
      <p className="text-xs text-text-secondary mb-3">{summary} {deload}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {indicators.map(i => (
          <div key={i.signal} className="rounded-control bg-surface-muted p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-primary">{i.label}</span>
              <Badge variant={i.status === 'warn' ? 'warning' : i.status === 'watch' ? 'info' : i.status === 'ok' ? 'success' : 'default'}>{tone[i.status]}</Badge>
            </div>
            <p className="text-[11px] text-text-secondary mt-1">{i.text}</p>
            {i.gate?.note && <p className="text-[11px] text-text-secondary mt-1 italic">{i.gate.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
