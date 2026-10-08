// ── /api/pipeline/status (SPEC §10) ─────────────────────
//
// Server-only route. It reads the stored (encrypted) Health Auto Export
// connection, probes the API only when connected, and
// reports each pipeline stage honestly. The key never leaves the server, and a
// failed live check is surfaced as an explicit state rather than replaced with
// demo data.

import { NextResponse } from 'next/server';
import { resolvePipelineStatus } from '@/lib/pipeline/status';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const report = await resolvePipelineStatus();
  return NextResponse.json(report, {
    status: 200,
    headers: {
      // Personal health context must never be cached by a shared proxy.
      'Cache-Control': 'no-store, private',
    },
  });
}
