'use client';

// ── Routine UI: shared pieces ───────────────────────────
//
// The light (one shared scale for every progression model), the data hook that
// reads /api/routine, and the plan-change card the analyst page reuses.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { Light } from '@/lib/routine/models/types';
import type { RoutineResponse } from '@/lib/routine/service';
import type { PlanChange } from '@/lib/routine/types';
import type { UnitSystem } from '@/lib/prefs';
import { Button } from '@/components/ui/primitives';

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
  yellow: 'hold and build',
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

export function LightLabel({ light }: { light: Light }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
      <LightDot light={light} />
      {LIGHT_LABEL[light]}
      <span className="text-text-secondary font-normal">· {LIGHT_MEANING[light]}</span>
    </span>
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
