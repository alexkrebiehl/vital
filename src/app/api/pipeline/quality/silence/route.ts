// ── /api/pipeline/quality/silence ───────────────────────

// Silence or restore one data-quality finding (see `@/lib/adapters/quality-silenced`).
// Configuration only: a check id and, for a per-metric check, a metric id.
//
//   POST   { checkId, metricId? } → silence it. The finding is hidden for ALL its
//                                   days, including days that show up later.
//   DELETE { checkId, metricId? } → restore it.
//
// Both are idempotent. Ids are validated against the known check ids and the
// metric registry (400); no database answers 503 with the reason; any other
// failure is a 500. The silenced list itself is served by GET /api/pipeline/quality.

import { NextResponse } from 'next/server';
import { validateSilenceInput, type SilencedKey } from '@/lib/adapters/quality-silenced';
import { silencedClient, pgRestore, pgSilence } from '@/lib/db/quality-silenced-store';
import { NO_DATABASE_CONFIGURED_REASON } from '@/lib/db/backend';
import type { PoolLike } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function handle(request: Request, write: (client: PoolLike, key: SilencedKey) => Promise<void>) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'The request body must be JSON.' }, 400);
  }
  const input = validateSilenceInput(body);
  if (!input.ok) return reply({ error: input.error }, 400);
  try {
    const client = silencedClient();
    if (!client) return reply({ error: NO_DATABASE_CONFIGURED_REASON }, 503);
    await write(client, input.key);
    return reply({ checkId: input.key.checkId, metricId: input.key.metricId }, 200);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'The silenced list could not be written.' }, 500);
  }
}

export function POST(request: Request) {
  return handle(request, pgSilence);
}

export function DELETE(request: Request) {
  return handle(request, pgRestore);
}
