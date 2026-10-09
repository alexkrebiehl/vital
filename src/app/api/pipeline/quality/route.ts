// ── /api/pipeline/quality ───────────────────────────────
//
// The data-quality checks on the live export. They run in the background
// after the live data loads (see `startQualityJob`), so /api/pipeline/status
// never waits for them; this route does, for up to QUALITY_WAIT_MS, and the
// Settings panel shows a "checking" state until it answers. Server-only: it reads
// the same cached dataset as every other route and never returns a token. The
// answer is assembled in `@/lib/pipeline/quality-read`, which the analyst's
// app.data_quality capability calls too.

import { NextResponse } from 'next/server';
import { readQualityResponse } from '@/lib/pipeline/quality-read';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await readQualityResponse(), { status: 200, headers: { 'Cache-Control': 'no-store, private' } });
}
