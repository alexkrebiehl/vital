// ── Shared request handling for the dashboard card routes ────────────────────
//
// A Next.js route file may export only its handlers and segment config, so the
// pieces both dashboard routes share live here: the no-store header, JSON body
// parsing, field checks, and turning a store error into the right status.

import { NextResponse } from 'next/server';
import { CardConflictError, CardNotFoundError } from '@/lib/db/dashboard-store';

export const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(message: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return jsonResponse({ error: message, ...extra }, status);
}

/** The parsed body, or a 400 response. */
export async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: errorResponse('The request body must be JSON.', 400) };
  }
}

/** A whole, positive revision, or null. */
export function revisionOf(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * The body as an object whose keys are all in `allowed`, or a 400 response
 * naming the first field that is not.
 */
export function strictKeys(
  body: unknown,
  allowed: readonly string[]
): { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: errorResponse('The request body must be a JSON object.', 400) };
  }
  const unknown = Object.keys(body).find(k => !allowed.includes(k));
  if (unknown !== undefined) {
    return { ok: false, response: errorResponse(`The request has an unknown field "${unknown}".`, 400) };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/** A store failure as a response: 404, 409 (with the current card when known) or 500 with the reason. */
export function storeErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof CardNotFoundError) return errorResponse(error.message, 404);
  if (error instanceof CardConflictError) {
    return errorResponse(error.message, 409, error.card ? { card: error.card } : {});
  }
  return errorResponse(error instanceof Error ? error.message : fallback, 500);
}
