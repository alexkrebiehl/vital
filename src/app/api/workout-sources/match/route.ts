// ── /api/workout-sources/match ──────────────────────────
//
// GET ?start=<iso>&end=<iso> — the workout-source session (exercises, sets,
// reps, load, RPE) that is the same workout as an Apple Health record, matched
// by time overlap, or `{ session: null }`. Read live from the sources' in-memory
// store; nothing is stored.

import { NextResponse } from 'next/server';
import { matchSession } from '@/lib/workout-sources/match';
import { loadTrainingData } from '@/lib/workout-sources/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start') ?? '';
  const end = url.searchParams.get('end') ?? '';
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return NextResponse.json({ error: 'start and end must be ISO instants.' }, { status: 400, headers: NO_STORE });
  }
  const data = await loadTrainingData();
  const session = matchSession({ start_time: start, end_time: end }, data.sessions);
  const source = session ? data.statuses.find(s => s.id === session.sourceId) : null;
  return NextResponse.json(
    { session, sourceName: source?.displayName ?? null, origin: data.origin },
    { headers: NO_STORE }
  );
}
