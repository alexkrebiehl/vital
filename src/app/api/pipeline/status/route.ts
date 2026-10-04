// ── /api/pipeline/status (SPEC §10) ─────────────────────
//
// Server-only route. It reads HAE_API_URL / HAE_API_KEY from the server
// environment, probes the Health Auto Export API only when configured, and
// reports each pipeline stage honestly. The key never leaves the server, and a
// failed live check is surfaced as an explicit state rather than replaced with
// demo data.

import { NextResponse } from 'next/server';
import { resolvePipelineStatus } from '@/lib/pipeline/status';
import { scoped } from '@/lib/identity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handleGET() {
  const report = await resolvePipelineStatus();
  return NextResponse.json(report, {
    status: 200,
    headers: {
      // Personal health context must never be cached by a shared proxy.
      'Cache-Control': 'no-store, private',
    },
  });
}

export const GET = scoped(handleGET);
