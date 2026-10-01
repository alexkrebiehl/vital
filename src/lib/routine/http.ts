// ── Routine API helpers (SERVER ONLY) ───────────────────
//
// One mapping from the routine's errors to HTTP answers, shared by every
// /api/routine route (a route file may only export its handlers).

import { NextResponse } from 'next/server';
import { LiveDataUnavailableError } from '../adapters/runtime';
import { PlanInputError } from './actions';

export const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export function routineFailure(error: unknown) {
  if (error instanceof PlanInputError) {
    return NextResponse.json({ error: error.message, errors: error.errors }, { status: 400, headers: NO_STORE });
  }
  if (error instanceof Error && (error.name === 'PlanConflictError')) {
    return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
  }
  if (error instanceof Error && error.name === 'PlanNotFoundError') {
    return NextResponse.json({ error: error.message }, { status: 404, headers: NO_STORE });
  }
  if (error instanceof LiveDataUnavailableError) {
    return NextResponse.json({ error: `The health data source could not be read: ${error.detail}` }, { status: 503, headers: NO_STORE });
  }
  const message = error instanceof Error ? error.message : 'The routine could not be loaded.';
  return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
}

