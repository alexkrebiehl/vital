// ── Removed sources: the Settings panel and "Delete now" (SERVER ONLY) ──────
//
// Plan §C5. The logic behind GET /api/sources/removed and
// DELETE /api/sources/{id}/data, kept out of the route files (a Next route may
// export nothing but its handlers).
//
// "Delete now" is refused unless the caller confirmed, refused while the source
// is still active, and only ever purges a source marked removed. It returns
// counts and ids, never a value.

import { getPool, type PoolLike } from '@/lib/db/pool';
import { recordActiveSources } from './lifecycle';
import { listRemovedSources, purgeGraceDays, purgeSources } from './purge-store';
import { DATA_SOURCES, activeSourceIds, defaultContext, type SourceContext } from './registry';

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export interface RemovedSourcesDeps {
  env?: NodeJS.ProcessEnv;
  client?: PoolLike | null;
  ctx?: SourceContext;
}

export interface RemovedSourceView {
  id: string;
  /** Shown on Settings only. */
  name: string;
  removedAt: string;
  /** When the automatic purge will run (removal + grace period). */
  purgeOn: string;
  hiddenConversations: number;
}

export interface RemovedSourcesView {
  graceDays: number;
  sources: RemovedSourceView[];
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function clientOf(deps: RemovedSourcesDeps): PoolLike | null {
  return 'client' in deps ? (deps.client ?? null) : getPool(deps.env ?? process.env);
}

function nameOf(id: string): string {
  return DATA_SOURCES.find(def => def.id === id)?.displayName ?? id;
}

/** GET /api/sources/removed. */
export async function removedSourcesResponse(deps: RemovedSourcesDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const graceDays = purgeGraceDays(env);
  try {
    const client = clientOf(deps);
    const rows = client ? await listRemovedSources(client) : [];
    const view: RemovedSourcesView = {
      graceDays,
      sources: rows.map(row => ({
        id: row.sourceId,
        name: nameOf(row.sourceId),
        removedAt: row.removedAt,
        purgeOn: new Date(Date.parse(row.removedAt) + graceDays * 86_400_000).toISOString(),
        hiddenConversations: row.hiddenConversations,
      })),
    };
    return json(view, 200);
  } catch {
    return json({ error: 'The removed sources could not be read.' }, 500);
  }
}

/** DELETE /api/sources/{id}/data?confirm=yes. */
export async function purgeSourceResponse(
  request: Request,
  sourceId: string,
  deps: RemovedSourcesDeps = {}
): Promise<Response> {
  if (!DATA_SOURCES.some(def => def.id === sourceId)) {
    return json({ error: 'There is no such data source.' }, 404);
  }
  if (new URL(request.url).searchParams.get('confirm') !== 'yes') {
    return json({ error: "Deleting a removed source's data is permanent. Confirm with ?confirm=yes." }, 400);
  }
  try {
    const client = clientOf(deps);
    if (!client) {
      return json({ error: 'No Postgres database is configured, so nothing is stored for any source.' }, 503);
    }
    // "Active" is decided by the registry, the single place that does. The
    // stored lifecycle is brought up to date first, so a removal that has not
    // been recorded yet is not mistaken for an active source.
    const active = await activeSourceIds(deps.ctx ?? defaultContext(deps.env ?? process.env));
    if ((active as string[]).includes(sourceId)) {
      return json({ error: 'That source is still active. Remove or disconnect it first.' }, 409);
    }
    await recordActiveSources(client, active);
    const outcome = await purgeSources(client, [sourceId]);
    if (outcome.purged.length === 0) {
      return json({ error: 'Nothing is stored for that source.' }, 404);
    }
    return json({ purged: outcome.purged, conversationsDeleted: outcome.conversationsDeleted }, 200);
  } catch {
    // The error text is not forwarded: it could carry a statement or a value.
    return json({ error: 'The data could not be deleted.' }, 500);
  }
}
