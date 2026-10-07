// ── Silenced data-quality findings, resolved for a request (SERVER ONLY) ─────
//
// The one place that reads the silenced list and applies it, so the pipeline
// status report and /api/pipeline/quality show the same findings and counts.
//
// A silenced list that cannot be read (no database, or the database fails) is
// treated as "nothing silenced": the findings stay visible rather than a
// failure hiding them, or breaking a status page that never needed a database.

import { applySilenced, type SilencedKey, type SilencedResult } from '@/lib/adapters/quality-silenced';
import type { DataQualityReport } from '@/lib/adapters/quality';
import { pgReadSilenced, silencedClient } from '@/lib/db/quality-silenced-store';
import type { PoolLike } from '@/lib/db/pool';

export interface SilencedDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). */
  client?: PoolLike | null;
  /** Use this list instead of reading it (tests). */
  silenced?: readonly SilencedKey[];
}

export async function resolveSilenced(deps: SilencedDeps = {}): Promise<readonly SilencedKey[]> {
  if (deps.silenced) return deps.silenced;
  try {
    const client = deps.client !== undefined ? deps.client : silencedClient(deps.env ?? process.env);
    return client ? await pgReadSilenced(client) : [];
  } catch {
    return [];
  }
}

export async function silencedView(report: DataQualityReport, deps: SilencedDeps = {}): Promise<SilencedResult> {
  return applySilenced(report, await resolveSilenced(deps));
}
