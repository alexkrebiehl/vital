// ── /api/dashboard/cards/:id ────────────────────────────
//
// One dashboard card. Configuration only: a spec (a metric id and day keys) and
// a size. No value is read or written here.
//
// The SERVER chooses the mode (the data mode); a card of the other mode is 404.
//
//   PUT    → { spec, size?, revision } replaces the settings of the card at
//            that revision: 200 { card } with the next revision. The card's
//            type cannot change; the spec is checked against the stored type.
//   DELETE → ?revision=N removes the card: 200 { id }.
//
// Status codes: 400 invalid body, spec, size or revision; 404 no such card in
// this mode; 409 a stale revision, answered { error, card } with the card as it
// is now so a change made in another tab is not overwritten; 503 when no
// database is configured; 500 for any other store failure. Responses are
// private and uncacheable.

import { readDataMode } from '@/lib/adapters/runtime';
import { NO_DATABASE_CONFIGURED_REASON } from '@/lib/db/backend';
import { CardNotFoundError, dashboardClient, pgDeleteCard, pgReadCard, pgReplaceCard } from '@/lib/db/dashboard-store';
import { validateCardInput } from '@/lib/dashboard/card-schemas';
import { errorResponse, jsonResponse, readBody, revisionOf, storeErrorResponse, strictKeys } from '@/lib/dashboard/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const noDatabase = () => errorResponse(NO_DATABASE_CONFIGURED_REASON, 503);

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = dashboardClient();
  if (!client) return noDatabase();
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const strict = strictKeys(read.body, ['type', 'spec', 'size', 'revision']);
  if (!strict.ok) return strict.response;
  const revision = revisionOf(strict.body.revision);
  if (revision === null) return errorResponse('revision must be the whole revision the change was based on.', 400);
  try {
    const mode = readDataMode();
    const stored = await pgReadCard(client, mode, id);
    if (!stored) throw new CardNotFoundError(`No card ${id}.`);
    const input = validateCardInput(strict.body, { type: stored.type, size: { w: stored.layout.w, h: stored.layout.h } });
    if (!input.ok) return errorResponse(input.errors.join(' '), 400);
    const card = await pgReplaceCard(client, mode, id, input, revision);
    return jsonResponse({ card });
  } catch (error) {
    return storeErrorResponse(error, 'The card could not be saved.');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = dashboardClient();
  if (!client) return noDatabase();
  const revision = revisionOf(new URL(request.url).searchParams.get('revision'));
  if (revision === null) return errorResponse('revision must be the whole revision the delete was based on.', 400);
  try {
    await pgDeleteCard(client, readDataMode(), id, revision);
    return jsonResponse({ id });
  } catch (error) {
    return storeErrorResponse(error, 'The card could not be deleted.');
  }
}
