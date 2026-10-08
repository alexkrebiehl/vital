// ── /api/dashboard/cards ────────────────────────────────
//
// The cards on the Dashboard page. Configuration only: a card is an id, a type,
// a spec (a metric id and day keys), a size and an order. No value is read or
// written here; values are computed in the browser.
//
// The SERVER chooses the mode (the data mode); the browser never sends it.
//
//   GET  → 200 { mode, cards, limits: { maxCards } }, in order.
//   POST → { type, spec, size? } appends a card: 201 { card }.
//   PUT  → { order: string[] } puts the cards in that order, in one write:
//          200 { cards }. The list must name every card exactly once.
//
// Status codes: 400 invalid body (not JSON, unknown field, unknown type, a spec
// or size the type refuses, an order that is not a list of ids); 409 at the
// card limit or when the order omits or repeats a card; 503 when no database
// is configured; 500 for any other store failure. Responses are private and
// uncacheable. The card types themselves come from the registry in
// `@/lib/dashboard/card-schemas`; this route names none of them.

import { readDataMode } from '@/lib/adapters/runtime';
import { NO_DATABASE_CONFIGURED_REASON } from '@/lib/db/backend';
import { dashboardClient, pgCreateCard, pgListCards, pgReorderCards } from '@/lib/db/dashboard-store';
import { validateCardInput } from '@/lib/dashboard/card-schemas';
import { errorResponse, jsonResponse, readBody, storeErrorResponse, strictKeys } from '@/lib/dashboard/http';
import { MAX_CARDS_PER_MODE } from '@/lib/dashboard/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const noDatabase = () => errorResponse(NO_DATABASE_CONFIGURED_REASON, 503);

export async function GET() {
  const client = dashboardClient();
  if (!client) return noDatabase();
  const mode = readDataMode();
  try {
    return jsonResponse({ mode, cards: await pgListCards(client, mode), limits: { maxCards: MAX_CARDS_PER_MODE } });
  } catch (error) {
    return storeErrorResponse(error, 'The cards could not be read.');
  }
}

export async function POST(request: Request) {
  const client = dashboardClient();
  if (!client) return noDatabase();
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const strict = strictKeys(read.body, ['type', 'spec', 'size']);
  if (!strict.ok) return strict.response;
  const input = validateCardInput(strict.body);
  if (!input.ok) return errorResponse(input.errors.join(' '), 400);
  try {
    const card = await pgCreateCard(client, readDataMode(), input);
    return jsonResponse({ card }, 201);
  } catch (error) {
    return storeErrorResponse(error, 'The card could not be saved.');
  }
}

export async function PUT(request: Request) {
  const client = dashboardClient();
  if (!client) return noDatabase();
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const strict = strictKeys(read.body, ['order']);
  if (!strict.ok) return strict.response;
  const { order } = strict.body;
  if (!Array.isArray(order) || !order.every(id => typeof id === 'string')) {
    return errorResponse('order must be a list of card ids.', 400);
  }
  try {
    return jsonResponse({ cards: await pgReorderCards(client, readDataMode(), order as string[]) });
  } catch (error) {
    return storeErrorResponse(error, 'The cards could not be reordered.');
  }
}
