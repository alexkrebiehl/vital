// ── Purge hooks for everything held in memory (SERVER ONLY) ──────────────
//
// "Removing a source erases it" (plan §8): when a source stops being active,
// nothing it contributed may survive in this process. Every module that holds
// source data or something derived from it registers a purger here, and
// `reconcileActiveSources()` runs them all when the active set changes.
//
// The registry lives on `globalThis`, like the briefing cache: Next builds the
// pages and the route handlers into separate server bundles, each with its own
// copy of every module-level cache. A purger registered by one bundle's copy of
// a module is therefore kept next to the other bundle's, never in place of it.
//
// This module imports nothing from the app (the registry of sources is loaded
// lazily), so any cache module can register a purger without an import cycle.
//
// A transient failure to LEARN the active set is never a removal: nothing is
// purged, and the next call tries again.

import type { SourceContext } from './registry';

/** Drops what a module holds for the removed sources. Synchronous and idempotent. */
export type Purger = (removedIds: string[]) => void;

export interface ReconcileResult {
  /** The active set now, sorted. */
  active: string[];
  /** Ids active at the previous reconcile that are not active now. */
  removed: string[];
  /** Ids active now that were not at the previous reconcile. */
  added: string[];
  /** True when the set differs from the previous one (or this is the first call). */
  changed: boolean;
  /** Names of purgers that threw. Their data is purged again at the next call. */
  failed: string[];
}

interface PurgeState {
  purgers: Map<string, Set<Purger>>;
  /** The active ids at the last successful reconcile; null before the first. */
  lastIds: string[] | null;
  inFlight: Promise<ReconcileResult> | null;
  /** The active set whose lifecycle record (removal times, purge) is not yet stored; retried. */
  lifecyclePending: string[] | null;
}

const STATE_KEY = Symbol.for('vital.sources.purge');

function state(): PurgeState {
  const g = globalThis as unknown as Record<symbol, PurgeState | undefined>;
  return (g[STATE_KEY] ??= { purgers: new Map(), lastIds: null, inFlight: null, lifecyclePending: null });
}

/**
 * Register a purger under a name. Registering the same function twice is a
 * no-op; two different functions under one name both run (one per bundle).
 */
export function registerPurger(name: string, purger: Purger): void {
  const held = state().purgers.get(name) ?? new Set<Purger>();
  held.add(purger);
  state().purgers.set(name, held);
}

/** The names of every registered purger, sorted (tests and diagnostics). */
export function purgerNames(): string[] {
  return [...state().purgers.keys()].sort();
}

/**
 * The active set as of the last reconcile in this process, as a key such as
 * `hae+oura`; empty before the first. Synchronous on purpose: the briefing key
 * is built on a path that cannot await.
 */
export function currentSourceKey(): string {
  return (state().lastIds ?? []).join('+');
}

/**
 * Tests only: forget the last set seen (and any pass in flight), as in a fresh
 * process. Purgers registered when their modules loaded are kept.
 */
export function resetPurgeStateForTests(): void {
  const s = state();
  s.lastIds = null;
  s.inFlight = null;
  s.lifecyclePending = null;
}

/** Tests only: forget every purger, including those the app modules registered. */
export function clearPurgersForTests(): void {
  state().purgers.clear();
}

function runPurgers(removed: string[]): string[] {
  const failed: string[] = [];
  for (const [name, set] of state().purgers) {
    for (const purger of set) {
      try {
        purger(removed);
      } catch {
        // Never log the error: a purger holds source data and its message could too.
        failed.push(name);
      }
    }
  }
  return failed;
}

/**
 * Store the lifecycle of the active set (db/lifecycle). A failure never breaks
 * a page: it is remembered and retried at the next reconcile. The module is
 * loaded lazily because it needs the database layer.
 */
async function recordLifecycle(active: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const s = state();
  try {
    const { syncLifecycle } = await import('./lifecycle');
    await syncLifecycle(active, env);
    s.lifecyclePending = null;
  } catch {
    s.lifecyclePending = active;
  }
}

async function reconcileOnce(ctx?: SourceContext): Promise<ReconcileResult> {
  const { activeSourceIds, defaultContext } = await import('./registry');
  const active: string[] = await activeSourceIds(ctx ?? defaultContext());
  const s = state();
  const previous = s.lastIds;
  const removed = previous ? previous.filter(id => !active.includes(id)) : [];
  const added = previous ? active.filter(id => !previous.includes(id)) : active;
  const changed = previous === null || removed.length > 0 || added.length > 0;
  if (!changed) {
    // A lifecycle record that could not be stored (database briefly down) is
    // retried until it is, so a removal is never lost.
    if (s.lifecyclePending) await recordLifecycle(active, (ctx ?? defaultContext()).env);
    return { active, removed, added, changed, failed: [] };
  }

  // Purge BEFORE the new key is published, so nothing can read a removed
  // source's data under the new key. A first call has nothing to purge.
  const failed = previous === null ? [] : runPurgers(removed);
  if (failed.length === 0) s.lastIds = active;
  // The lifecycle (removal times, hiding, the purge) follows the set, and also
  // runs at the first call so a source removed while the process was down is found.
  await recordLifecycle(active, (ctx ?? defaultContext()).env);
  return { active, removed, added, changed, failed };
}

/**
 * Compare the registry's active set with the last one seen in this process.
 * When it changed, run every purger with the removed ids, then store the new
 * set. Concurrent callers share one pass. Cheap when nothing changed.
 *
 * Call it at the top of `installDataset` and from the connect/disconnect routes.
 * It throws only if the registry could not be read (an invalid database
 * configuration); callers on a page path should treat that as "unchanged".
 */
export function reconcileActiveSources(ctx?: SourceContext): Promise<ReconcileResult> {
  const s = state();
  if (s.inFlight) return s.inFlight;
  const run = reconcileOnce(ctx).finally(() => {
    if (state().inFlight === run) state().inFlight = null;
  });
  s.inFlight = run;
  return run;
}

/**
 * `reconcileActiveSources` for a request path: a registry that cannot be read
 * (database down, invalid configuration) is reported by the code that needs the
 * registry. Here it only means "cannot tell", and nothing is purged.
 */
export async function reconcileQuietly(ctx?: SourceContext): Promise<ReconcileResult | null> {
  try {
    return await reconcileActiveSources(ctx);
  } catch {
    return null;
  }
}
