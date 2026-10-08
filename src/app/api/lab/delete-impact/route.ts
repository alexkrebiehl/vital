// GET /api/lab/delete-impact — what deleting a report would take with it
// (counts only). See `@/lib/lab/delete-impact`.
import { NextResponse } from 'next/server';
import { readLabDeleteImpact } from '@/lib/lab/delete-impact';
import { storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const client = storeClient();
  if (!client) {
    return NextResponse.json({ error: 'No Postgres database is configured.' }, { status: 503, headers: NO_STORE });
  }
  try {
    return NextResponse.json(await readLabDeleteImpact(client), { status: 200, headers: NO_STORE });
  } catch {
    // The error text is not forwarded: it could carry a statement.
    return NextResponse.json({ error: 'The report count could not be read.' }, { status: 500, headers: NO_STORE });
  }
}
