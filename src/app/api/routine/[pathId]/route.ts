// ── /api/routine/[pathId] ───────────────────────────────
//
// One progression path in detail: its stages, the session table with signals,
// the light and its reasons, the next action, the stage's cues and checks, and
// the plan's recovery indicators. `?system=imperial` for lb / mi.

import { NextResponse } from 'next/server';
import type { UnitSystem } from '@/lib/prefs';
import { NO_STORE, routineFailure } from '@/lib/routine/http';
import { loadRoutine, pathDetailFrom } from '@/lib/routine/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ pathId: string }> }) {
  const { pathId } = await params;
  const system: UnitSystem = new URL(request.url).searchParams.get('system') === 'imperial' ? 'imperial' : 'metric';
  try {
    const loaded = await loadRoutine(system);
    if (!loaded.routine) {
      return NextResponse.json({ error: 'There is no active training plan.' }, { status: 404, headers: NO_STORE });
    }
    const detail = pathDetailFrom(loaded.routine, pathId);
    if (!detail) {
      return NextResponse.json({ error: `The active plan has no path "${pathId}".` }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ ...detail, sources: loaded.sources, origin: loaded.origin }, { headers: NO_STORE });
  } catch (error) {
    return routineFailure(error);
  }
}
