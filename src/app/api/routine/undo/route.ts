// ── /api/routine/undo ───────────────────────────────────
//
// POST { change: PlanChange } — reverse a change the analyst or the reader made.
// A new plan is archived (and the one it replaced re-activated), an edit is
// reverted to the revision before it (as a new, itself undoable revision), an
// archive is re-activated. Refused with 409 when the plan has changed since.

import { NextResponse } from 'next/server';
import { NO_STORE, routineFailure } from '@/lib/routine/http';
import { undoPlanChange } from '@/lib/routine/service';
import type { PlanChange } from '@/lib/routine/types';
import { scoped } from '@/lib/identity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function readChange(raw: unknown): PlanChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'create' && kind !== 'update' && kind !== 'archive') return null;
  if (typeof c.planId !== 'string' || typeof c.toRevision !== 'number') return null;
  if (c.fromRevision !== null && typeof c.fromRevision !== 'number') return null;
  return {
    kind,
    planId: c.planId,
    planTitle: typeof c.planTitle === 'string' ? c.planTitle : '',
    fromRevision: (c.fromRevision as number | null) ?? null,
    toRevision: c.toRevision,
    previousActivePlanId: typeof c.previousActivePlanId === 'string' ? c.previousActivePlanId : null,
    summary: typeof c.summary === 'string' ? c.summary.slice(0, 300) : 'a plan change',
    diff: [],
  };
}

async function handlePOST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  const change = readChange(body.change);
  if (!change) return NextResponse.json({ error: 'The request must carry the change to undo.' }, { status: 400, headers: NO_STORE });
  try {
    const active = await undoPlanChange(change);
    return NextResponse.json({ ok: true, activePlanId: active?.id ?? null }, { headers: NO_STORE });
  } catch (error) {
    return routineFailure(error);
  }
}

export const POST = scoped(handlePOST);
