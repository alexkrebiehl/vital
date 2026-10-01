// ── /api/routine/workouts/[templateId] ──────────────────
//
// One session template of the active plan as a day of training: the domains it
// covers, each slot's current exercise and light, and the next step or stage
// once a path is at yellow-green or green. `?system=imperial` for lb / mi.

import { NextResponse } from 'next/server';
import type { UnitSystem } from '@/lib/prefs';
import { NO_STORE, routineFailure } from '@/lib/routine/http';
import { loadRoutine, workoutDetailFrom } from '@/lib/routine/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const system: UnitSystem = new URL(request.url).searchParams.get('system') === 'imperial' ? 'imperial' : 'metric';
  try {
    const loaded = await loadRoutine(system);
    if (!loaded.routine) {
      return NextResponse.json({ error: 'There is no active training plan.' }, { status: 404, headers: NO_STORE });
    }
    const detail = workoutDetailFrom(loaded.routine, templateId);
    if (!detail) {
      return NextResponse.json({ error: `The active plan has no workout "${templateId}".` }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ ...detail, sources: loaded.sources, origin: loaded.origin }, { headers: NO_STORE });
  } catch (error) {
    return routineFailure(error);
  }
}
