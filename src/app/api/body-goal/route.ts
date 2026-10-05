// ── /api/body-goal ──────────────────────────────────────
//
// The goal the Body and Nutrition pages are read against (see
// `@/lib/body-goal/types`). Configuration only: a target, a pace and the day it
// was set — never a reading.
//
//   GET    → { active, history }
//   PUT    → { goal: {kind, target, paceKgPerWeek}, revision, startNew }
//            `revision` is the active goal's revision as the client last saw it
//            (null when there was none). `startNew` archives the active goal and
//            starts a new one today; otherwise the active goal is edited in
//            place and keeps its start day. With no active goal a PUT always
//            starts one.
//   DELETE → ?revision=N — end the active goal today.
//
// A stale revision is refused with 409, like /api/preferences. A missing or
// unreachable database answers 500 with the reason. Responses are private and
// uncacheable.

import { NextResponse } from 'next/server';
import { validateBodyGoalInput } from '@/lib/body-goal/types';
import {
  BodyGoalConflictError,
  endBodyGoal,
  readBodyGoals,
  startBodyGoal,
  updateBodyGoal,
} from '@/lib/db/body-goal-store';
import { readProfile } from '@/lib/profile/store';
import { todayKeyIn } from '@/lib/profile/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The goal could not be read or written.';
}

function failure(error: unknown) {
  const status = error instanceof BodyGoalConflictError ? 409 : 500;
  return NextResponse.json({ error: messageOf(error) }, { status, headers: NO_STORE });
}

async function today(): Promise<string> {
  return todayKeyIn((await readProfile()).timezone);
}

function parseRevision(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  return undefined;
}

export async function GET() {
  try {
    return NextResponse.json(await readBodyGoals(), { status: 200, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'The request body must be a JSON object.' }, { status: 400, headers: NO_STORE });
  }
  const { goal, revision, startNew, ...rest } = body as Record<string, unknown>;
  const errors: string[] = [];
  if (Object.keys(rest).length > 0) errors.push(`Unknown field(s): ${Object.keys(rest).join(', ')}.`);
  const expected = parseRevision(revision);
  if (expected === undefined) errors.push('"revision" must be the active goal\'s revision, or null when there is none.');
  if (startNew !== undefined && typeof startNew !== 'boolean') errors.push('"startNew" must be a boolean.');
  const validated = validateBodyGoalInput(goal);
  if (!validated.ok) errors.push(...validated.errors);
  if (errors.length > 0 || !validated.ok || expected === undefined) {
    return NextResponse.json({ error: errors.join(' '), errors }, { status: 400, headers: NO_STORE });
  }

  try {
    const saved =
      expected === null || startNew === true
        ? await startBodyGoal(validated.input, await today(), expected)
        : await updateBodyGoal(validated.input, expected);
    return NextResponse.json(saved, { status: 200, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const raw = new URL(request.url).searchParams.get('revision');
  const revision = raw === null ? undefined : parseRevision(Number(raw));
  if (!revision) {
    return NextResponse.json({ error: '"revision" must name the active goal\'s revision.' }, { status: 400, headers: NO_STORE });
  }
  try {
    await endBodyGoal(await today(), revision);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
