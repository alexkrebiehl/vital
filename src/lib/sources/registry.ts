// ── Data-source registry (SERVER ONLY) ───────────────────
//
// ONE list of every data source Vital can read, and the single place that
// decides whether a source is "active" (see the plan's §8: removal means the
// source never existed). Nothing else may decide that on its own.
//
// Activity is decided from configuration and from the existence of a credential
// or a document. It never reads a health value and never calls a source's API.

import { OURA_APP_SOURCE_ID } from '@/lib/adapters/oura/app-store';
import { hasCredentialRow } from '@/lib/db/credentials-store';
import { getPool, type PoolLike } from '@/lib/db/pool';
import { hevyPlugin } from '@/lib/workout-sources/hevy';

export type DataSourceId = 'hae' | 'oura' | 'hevy' | 'lab';
export type DataSourceKind = 'health' | 'workout-detail' | 'documents';

export interface SourceContext {
  env: NodeJS.ProcessEnv;
  /** Whether a stored credential exists for this source id. */
  hasCredential(id: string): Promise<boolean>;
  /** How many lab reports are stored. */
  labReportCount(): Promise<number>;
}

export interface DataSourceDef {
  id: DataSourceId;
  /** Shown on Settings only; no other page names a source. */
  displayName: string;
  kind: DataSourceKind;
  isActive(ctx: SourceContext): Promise<boolean>;
}

export const DATA_SOURCES: readonly DataSourceDef[] = [
  {
    id: 'hae',
    displayName: 'Health Auto Export',
    kind: 'health',
    // Connected: a stored (encrypted) endpoint and key. The environment is never consulted.
    isActive: async ctx => ctx.hasCredential('hae'),
  },
  {
    id: 'oura',
    displayName: 'Oura Ring',
    kind: 'health',
    // Configured AND connected: stored app credentials and a stored login. The environment
    // is never consulted for the client ID, secret or redirect URI.
    isActive: async ctx => (await ctx.hasCredential(OURA_APP_SOURCE_ID)) && (await ctx.hasCredential('oura')),
  },
  {
    id: 'hevy',
    displayName: 'Hevy',
    kind: 'workout-detail',
    isActive: async ctx => hevyPlugin.readConfig(ctx.env) !== null,
  },
  {
    id: 'lab',
    displayName: 'Lab reports',
    kind: 'documents',
    // User-uploaded. Removing it is the existing "delete report" action, and
    // the last delete makes it inactive.
    isActive: async ctx => (await ctx.labReportCount()) > 0,
  },
];

/** Ids of the active sources, sorted. */
export async function activeSourceIds(ctx: SourceContext = defaultContext()): Promise<DataSourceId[]> {
  const flags = await Promise.all(DATA_SOURCES.map(async def => ((await def.isActive(ctx)) ? def.id : null)));
  return flags.filter((id): id is DataSourceId => id !== null).sort();
}

/** The active set as a cache/key suffix, e.g. `hae+lab+oura`. Empty when none. */
export async function sourceSetKey(ctx: SourceContext = defaultContext()): Promise<string> {
  return (await activeSourceIds(ctx)).join('+');
}

/** Ids of the active sources that feed the health dataset, sorted. */
export async function activeHealthSources(ctx: SourceContext = defaultContext()): Promise<DataSourceId[]> {
  const active = new Set(await activeSourceIds(ctx));
  return DATA_SOURCES.filter(def => def.kind === 'health' && active.has(def.id))
    .map(def => def.id)
    .sort();
}

/**
 * The context for this process. Both lookups read the one Postgres pool and
 * count or test for existence only; no credential is decrypted and no lab value
 * is read. With no database configured nothing is stored, so both answer
 * "none". An invalid database configuration still throws, as everywhere else.
 */
export function defaultContext(
  env: NodeJS.ProcessEnv = process.env,
  clientFor: () => PoolLike | null = () => getPool(env)
): SourceContext {
  return {
    env,
    hasCredential: async id => {
      const client = clientFor();
      return client ? hasCredentialRow(client, id) : false;
    },
    labReportCount: async () => {
      const client = clientFor();
      if (!client) return 0;
      const result = await client.query('SELECT count(*)::int AS n FROM lab_reports');
      return Number(result.rows[0]?.n ?? 0);
    },
  };
}
