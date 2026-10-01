'use client';

// ── Exercises of a workout, from its workout source ─────
//
// Apple Health knows a strength workout only as "Strength Training". When a
// workout source (Hevy) logged the same session, this lists what was actually
// done: each exercise with its working sets.

import { useEffect, useState } from 'react';
import type { UnitSystem } from '@/lib/prefs';
import type { TrainingSession } from '@/lib/workout-sources/types';
import { convertValue, displayUnit } from '@/lib/metrics/format';
import { DataStateNote } from '@/components/ui/primitives';

type State = { status: 'loading' } | { status: 'none' } | { status: 'error' } | { status: 'ok'; session: TrainingSession; sourceName: string | null };

function setText(set: TrainingSession['exercises'][number]['sets'][number], units: UnitSystem): string {
  const parts: string[] = [];
  if (set.reps !== undefined) parts.push(`${set.reps} reps`);
  if (set.weightKg !== undefined && set.weightKg > 0) parts.push(`${Math.round(convertValue(set.weightKg, 'kg', units) * 10) / 10} ${displayUnit('kg', units)}`);
  if (set.durationS !== undefined) parts.push(`${set.durationS} s`);
  if (set.distanceM !== undefined) parts.push(`${Math.round(convertValue(set.distanceM / 1000, 'km', units) * 100) / 100} ${displayUnit('km', units)}`);
  if (set.rpe !== undefined) parts.push(`RPE ${set.rpe}`);
  return parts.join(' · ') || '—';
}

export function SessionExercises({ start, end, units }: { start: string; end: string; units: UnitSystem }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workout-sources/match?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { session: TrainingSession | null; sourceName: string | null }) => {
        if (cancelled) return;
        setState(body.session ? { status: 'ok', session: body.session, sourceName: body.sourceName } : { status: 'none' });
      })
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  if (state.status === 'loading' || state.status === 'none') return null;
  if (state.status === 'error') return <DataStateNote>The workout source could not be checked for this session&apos;s exercises.</DataStateNote>;
  return (
    <div className="pt-3 border-t border-border">
      <h3 className="text-sm font-semibold text-text-primary mb-1">
        Exercises{state.sourceName ? <span className="font-normal text-text-secondary"> · from {state.sourceName}</span> : null}
      </h3>
      <ul className="space-y-2">
        {state.session.exercises.map((e, i) => (
          <li key={`${e.name}-${i}`} className="text-xs">
            <span className="font-medium text-text-primary">{e.name}</span>
            {e.loadMeaning === 'assistance' && <span className="text-text-secondary"> (weight is assistance)</span>}
            <ol className="text-text-secondary tnum mt-0.5">
              {e.sets.map((s, j) => (
                <li key={j}>
                  {s.kind === 'warmup' ? 'Warm-up' : `Set ${e.sets.filter((x, k) => k <= j && x.kind !== 'warmup').length}`}: {setText(s, units)}
                  {s.kind === 'failure' ? ' (to failure)' : s.kind === 'dropset' ? ' (drop set)' : ''}
                </li>
              ))}
            </ol>
            {e.notes && <p className="text-[11px] text-text-secondary italic">{e.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
