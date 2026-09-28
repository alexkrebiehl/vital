// ── /api/workout-sources/sessions ───────────────────────
//
// GET — when each workout-source session happened and which source logged it,
// without the exercises: enough for a list of Apple Health workouts to mark the
// ones a source also recorded (matched client-side with matchSession). Read live
// from the sources' in-memory store; nothing is stored.

import { NextResponse } from 'next/server';
import { loadTrainingData } from '@/lib/workout-sources/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const data = await loadTrainingData();
  const names = new Map(data.statuses.map(s => [s.id, s.displayName]));
  const sessions = data.sessions.map(s => ({
    startTime: s.startTime,
    endTime: s.endTime,
    sourceName: names.get(s.sourceId) ?? s.sourceId,
  }));
  return NextResponse.json({ sessions, origin: data.origin }, { headers: NO_STORE });
}
