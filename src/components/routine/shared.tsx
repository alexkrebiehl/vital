'use client';

// ── Routine UI: shared pieces ───────────────────────────
//
// The light (one shared scale for every progression model), the data hook that
// reads /api/routine, and the plan-change card the analyst page reuses.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, PlugZap, Undo2 } from 'lucide-react';
import type { Light, Readiness } from '@/lib/routine/models/types';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { RoutineResponse } from '@/lib/routine/service';
import type { PlanChange } from '@/lib/routine/types';
import type { UnitSystem } from '@/lib/prefs';
import { Button, Card } from '@/components/ui/primitives';

export const LIGHT_LABEL: Record<Light, string> = {
  green: 'Green',
  'yellow-green': 'Yellow-green',
  yellow: 'Yellow',
  red: 'Red',
  none: 'No data',
};

export const LIGHT_MEANING: Record<Light, string> = {
  green: 'ready to progress',
  'yellow-green': 'nearly there',
  yellow: 'continue building',
  red: 'back off',
  none: 'nothing logged yet',
};

const LIGHT_DOT: Record<Light, string> = {
  green: 'bg-green-500',
  'yellow-green': 'bg-lime-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
  none: 'bg-transparent border border-border',
};

export function LightDot({ light, size = 10 }: { light: Light; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${LIGHT_DOT[light]}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** A path's light; `tracked={false}` says nothing can be read, rather than nothing was logged. */
export function LightLabel({ light, tracked = true }: { light: Light; tracked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
      <LightDot light={tracked ? light : 'none'} />
      {tracked ? LIGHT_LABEL[light] : 'Not tracked'}
      <span className="text-text-secondary font-normal">· {tracked ? LIGHT_MEANING[light] : 'needs a workout source'}</span>
    </span>
  );
}

/**
 * Shown wherever the routine is, when no workout source is connected and some
 * paths can only be judged from one. Nothing when every path can be followed
 * through Apple Health workout types.
 */
export function ExerciseDataNotice({ routine }: { routine: RoutineOverview }) {
  if (routine.exerciseData) return null;
  const untracked = routine.paths.filter(p => !p.tracked).length;
  if (untracked === 0) return null;
  const all = untracked === routine.paths.length;
  return (
    <Card className="p-4" as="section" aria-labelledby="exercise-data-title">
      <div className="flex items-start gap-3">
        <PlugZap size={18} className="text-category-attention shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h3 id="exercise-data-title" className="text-sm font-semibold text-text-primary">
            {all ? 'Progress can’t be tracked yet' : `Progress can’t be tracked for ${untracked} of ${routine.paths.length} paths`}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed max-w-2xl">
            No workout source is connected. Apple Health records a workout&rsquo;s type and duration, but judging{' '}
            {all ? 'these paths' : 'those paths'} needs the exercises, sets, reps and load a training app such as Hevy logs.
            Until one is connected they show as not tracked, and sessions aren&rsquo;t counted as missed. The plan itself works as
            usual.
          </p>
          <Link href="/settings?tab=connections" className="inline-flex items-center gap-1 text-xs text-primary hover:underline min-h-[24px]">
            Connect a workout source <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export interface RoutineApiResponse extends RoutineResponse {
  references: { id: string; label: string }[];
}

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

/** GET a routine endpoint, re-read on demand and when the unit system changes. */
export function useRoutineFetch<T>(url: string, system: UnitSystem): { state: Loaded<T>; reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState(s => (s.status === 'ok' ? s : { status: 'loading' }));
    fetch(`${url}${url.includes('?') ? '&' : '?'}system=${system}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `The routine answered HTTP ${res.status}.`);
        return body as T;
      })
      .then(data => !cancelled && setState({ status: 'ok', data }))
      .catch(e => !cancelled && setState({ status: 'error', message: e instanceof Error ? e.message : 'The routine could not be loaded.' }));
    return () => {
      cancelled = true;
    };
  }, [url, system, nonce]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { state, reload };
}

export async function undoChange(change: PlanChange): Promise<string | null> {
  const res = await fetch('/api/routine/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ change }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Undo failed (HTTP ${res.status}).`;
}

/** What changed in the plan, with a link to the routine and an undo button. */
export function PlanChangeCard({ change, onUndone }: { change: PlanChange; onUndone?: () => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'undone' | { error: string }>('idle');
  const verb = change.kind === 'create' ? 'Created' : change.kind === 'archive' ? 'Archived' : 'Updated';
  return (
    <div className="rounded-control border border-border bg-surface-muted p-3 space-y-2" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">
          {verb} plan: {change.planTitle}
        </p>
        <span className="text-[11px] text-text-secondary">{change.summary}</span>
      </div>
      {change.diff.length > 0 && (
        <ul className="text-xs text-text-secondary space-y-0.5 list-disc pl-4">
          {change.diff.slice(0, 8).map(line => (
            <li key={line}>{line}</li>
          ))}
          {change.diff.length > 8 && <li>…and {change.diff.length - 8} more</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/workouts#routine" className="text-xs font-medium text-primary hover:underline">
          View routine
        </Link>
        {state === 'undone' ? (
          <span className="text-xs text-text-secondary">Undone.</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={state === 'working'}
            onClick={async () => {
              setState('working');
              const error = await undoChange(change);
              if (error) setState({ error });
              else {
                setState('undone');
                onUndone?.();
              }
            }}
          >
            <Undo2 size={12} className="mr-1" aria-hidden="true" />
            Undo
          </Button>
        )}
        {typeof state === 'object' && <span className="text-xs text-category-attention">{state.error}</span>}
      </div>
    </div>
  );
}

/** Progress toward the next step or stage: the work toward the marker, effort, then qualifying sessions. */
export function ReadinessBar({ readiness, from, to, className = '' }: { readiness: Readiness; from: string; to: string | null; className?: string }) {
  const pct = Math.min(100, Math.round(readiness.progress * 100));
  return (
    <div className={className}>
      <div className="flex justify-between gap-2 text-[11px] text-text-secondary mb-1">
        <span className="min-w-0 truncate">
          {from}
          {to ? ` → ${to}` : ''}
        </span>
        <span className="tnum shrink-0">{readiness.label}</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-surface-muted overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Progress toward ${to ?? 'the marker'}`}
        title={`${pct}% of the way to ${to ?? 'the marker'}`}
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
