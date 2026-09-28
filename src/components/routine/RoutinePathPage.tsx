'use client';

// ── /workouts/routine/[pathId] ──────────────────────────
//
// One progression path in detail: which stage it is on and what comes next, the
// recent sessions with what each one signals, the light with its reasons, the
// next action, the stage's cues and checks, and the recovery indicators that can
// hold progression back.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, CircleDot, PauseCircle } from 'lucide-react';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { RecoveryIndicator } from '@/lib/routine/recovery';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { Badge, Button, Card, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { useUnits } from '@/components/ui/UnitsProvider';
import { LightLabel, useRoutineFetch } from './shared';
import { pathHref } from './RoutineSection';
import { pathSuggestions } from './discuss-suggestions';
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
            {routine.title} · {path.areaName}
          </p>
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-tight text-text-primary leading-tight mt-1">
            {path.pathName} path
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Current stage: {stageNumber > 1 || path.stages.length > 1 ? `Stage ${stageNumber} ` : ''}
            {path.stage.name.toLowerCase()}
            {path.step ? ` · ${path.step.name}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge>{path.modelLabel}</Badge>
            {path.stage.startedOn && <Badge>Since {path.stage.startedOn}</Badge>}
            {path.nextStage && <Badge variant="accent">Next: {path.nextStage.name}</Badge>}
          </div>
        </div>
        <DiscussButton
          context={{ kind: 'routine-path', pathId: path.pathId }}
          subject={`the ${path.pathName} path`}
          suggestions={pathSuggestions(path)}
          onPlanChange={reload}
        />
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

      <AreaSiblings routine={routine} path={path} />

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
        <span className="text-sm font-semibold text-text-primary">Light:</span>
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
  const [all, setAll] = useState(false);
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
  const rows = all ? path.rows : path.rows.slice(-12);
  const otherStages = new Set(path.rows.flatMap(r => [r, ...(r.also ?? [])]).filter(r => r.stageId !== path.stage.id).map(r => r.stageId)).size;
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
          {rows.map(r => {
            // One row per day: the lead entry, then other stages' work from the same day.
            const entries = [r, ...(r.also ?? [])];
            const tone = (e: typeof r) => (e.stageId !== path.stage.id ? 'text-text-secondary' : 'text-text-primary');
            return (
              <tr key={`${r.dates.join(',')}:${r.stageId}`} className="border-b border-border last:border-b-0 align-top">
                <td className={`py-2 pr-4 whitespace-nowrap tnum ${tone(r)}`}>{r.dates.map(formatDayKeyShort).join(' / ')}</td>
                <td className="py-2 pr-4">
                  {entries.map(e => (
                    <span key={e.stageId} className={`block ${tone(e)}`}>
                      {e.work}
                      {e.notes && <span className="block text-[11px] text-text-secondary italic">{e.notes}</span>}
                    </span>
                  ))}
                </td>
                <td className="py-2 pr-4 text-right tnum whitespace-nowrap">
                  {entries.map(e => <span key={e.stageId} className={`block ${tone(e)}`}>{e.headline}</span>)}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">
                  {entries.map(e => <span key={e.stageId} className="block">{e.effort ?? '—'}</span>)}
                </td>
                <td className="py-2">
                  {entries.map(e => <span key={e.stageId} className={`block ${tone(e)}`}>{e.signal}</span>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <p className="text-[11px] text-text-secondary">
          Every stage of this path{otherStages > 0 ? ' — other stages are shown in grey, each judged against its own marker' : ''}.
          {' '}The light and next action are about {path.stage.name.toLowerCase()}.
        </p>
        {path.rows.length > 12 && (
          <Button variant="ghost" size="sm" onClick={() => setAll(a => !a)}>
            {all ? 'Show recent' : `Show all ${path.rows.length} rows`}
          </Button>
        )}
      </div>
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

/** The other paths of the same focus area, so the page covers the whole domain. */
function AreaSiblings({ routine, path }: { routine: RoutineOverview; path: PathProgress }) {
  const siblings = routine.paths.filter(p => p.areaId === path.areaId && p.pathId !== path.pathId);
  if (siblings.length === 0) return null;
  return (
    <Card className="p-5" as="section" aria-label={`Also in ${path.areaName}`}>
      <h2 className="text-sm font-semibold text-text-primary mb-3">Also in {path.areaName}</h2>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 list-none p-0 m-0">
        {siblings.map(p => (
          <li key={p.pathId}>
            <Link href={pathHref(p.pathId)} className="block rounded-control bg-surface-muted p-3 hover:bg-accent-tint transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">{p.pathName}</span>
                <LightLabel light={p.light} />
              </div>
              <p className="text-sm font-medium text-text-primary">{p.stage.name}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {p.lastSession ? `Last: ${p.lastSession.work} (${formatDayKeyShort(p.lastSession.date)})` : 'Nothing logged yet'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
