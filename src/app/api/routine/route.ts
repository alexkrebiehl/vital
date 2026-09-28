// ── /api/routine ────────────────────────────────────────
//
// GET   the active training plan evaluated against the reader's sessions:
//       week and blocks, what is next, every path's light and next action,
//       recovery indicators, and the status of each workout source.
//       `?system=imperial` renders loads and distances in lb / mi.
// POST  { action: 'start-reference', reference }  start from a reference plan
//       { action: 'archive' }                       put the active plan away
//
// Plans are configuration; the sessions they are evaluated against are read live
// and never stored. Responses are private and uncacheable.

import { NextResponse } from 'next/server';
import type { UnitSystem } from '@/lib/prefs';
import { archiveActivePlan, startFromReference } from '@/lib/routine/actions';
import { NO_STORE, routineFailure as failure } from '@/lib/routine/http';
import { loadRoutine } from '@/lib/routine/service';
import { REFERENCE_PLANS } from '@/lib/routine/templates';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const system: UnitSystem = new URL(request.url).searchParams.get('system') === 'imperial' ? 'imperial' : 'metric';
  try {
    const routine = await loadRoutine(system);
    return NextResponse.json(
      { ...routine, references: REFERENCE_PLANS.map(r => ({ id: r.id, label: r.label })) },
      { headers: NO_STORE }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  try {
    if (body.action === 'start-reference' && typeof body.reference === 'string') {
      const label = REFERENCE_PLANS.find(r => r.id === body.reference)?.label ?? body.reference;
      const result = await startFromReference(body.reference, { source: 'user', summary: `Started from the ${label} example` });
      return NextResponse.json({ change: result.change, inferred: result.inferred }, { headers: NO_STORE });
    }
    if (body.action === 'archive') {
      const change = await archiveActivePlan({ source: 'user', summary: 'Archived the plan' });
      return NextResponse.json({ change }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
