// ── Training-session store (server process only) ────────
//
// One store per PROFILE per server process holds every source's synced sessions.
// It lives on `globalThis` under a registered symbol, for the same reason as the
// briefing cache (src/lib/briefing/index.ts): Next builds the app into several
// server bundles, and a module-level Map would give each bundle its own copy, so
// the Workouts API and the analyst would each backfill Hevy separately and could
// disagree about what the user did.
//
// Freshness uses the shared TtlCache: a fresh entry is served as-is, a stale one
// is served immediately while one background sync runs, and only a cold source
// makes a caller wait. A failed sync keeps the previous sessions and records the
// error for the status panel — it never replaces real history with nothing.
//
// Demo mode (VITAL_DATA_MODE ≠ live) serves the committed training fixtures, the
// same way the HAE dataset serves its fixtures, so demo pages never call Hevy.
//
// Sessions are health data: they are never written to the database.

import { TtlCache } from '../adapters/cache';
import { readDataMode } from '../adapters/runtime';
import demoFixtures from '../../data/training-fixtures.json';
import { enabledSources, sourceLookbackDays, WORKOUT_SOURCE_PLUGINS } from './registry';
import type {
  ExerciseTemplateInfo,
  SourceRequestDeps,
  SourceSyncState,
  TrainingSession,
  WorkoutSourceStatus,
} from './types';
import { serverEnv } from '@/lib/identity/env';
import { cacheOwner, configVarName } from '@/lib/identity/scope';

interface DemoFixtures {
  sourceId: string;
  displayName: string;
  sessions: TrainingSession[];
  templates: ExerciseTemplateInfo[];
}

export const DEMO_TRAINING = demoFixtures as unknown as DemoFixtures;

interface ProcessStore {
  states: Map<string, SourceSyncState>;
  errors: Map<string, string | null>;
  ttlBySource: Map<string, number>;
  cache: TtlCache;
}

const STORE_KEY = Symbol.for('vital.training.store');

/** One store per profile: each person's sources sync, cache and fail on their own. */
function processStore(owner: string = cacheOwner()): ProcessStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, ProcessStore> };
  const stores = (g[STORE_KEY] ??= new Map());
  let store = stores.get(owner);
  if (!store) {
    const ttlBySource = new Map<string, number>();
    store = {
      states: new Map(),
      errors: new Map(),
      ttlBySource,
      // One TTL per cache; sources share the shortest configured one.
      cache: new TtlCache(() => (ttlBySource.size ? Math.min(...ttlBySource.values()) : 300_000)),
    };
    stores.set(owner, store);
  }
  return store;
}

/** Drop every held session. Tests only. */
export function resetTrainingStoreForTests(): void {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, ProcessStore> };
  delete g[STORE_KEY];
}

function byStart(a: TrainingSession, b: TrainingSession): number {
  return a.startTime.localeCompare(b.startTime);
}

export interface TrainingData {
  origin: 'live' | 'demo';
  /** Every session from every source, oldest first. */
  sessions: TrainingSession[];
  statuses: WorkoutSourceStatus[];
}

function newestStart(sessions: TrainingSession[]): string | null {
  let newest: string | null = null;
  for (const s of sessions) if (!newest || s.startTime > newest) newest = s.startTime;
  return newest;
}

function demoData(): TrainingData {
  const sessions = [...DEMO_TRAINING.sessions].sort(byStart);
  return {
    origin: 'demo',
    sessions,
    statuses: WORKOUT_SOURCE_PLUGINS.map(p => ({
      id: p.id,
      displayName: p.displayName,
      envVars: p.envVars,
      configured: false,
      host: null,
      origin: p.id === DEMO_TRAINING.sourceId ? 'demo' : 'none',
      sessions: p.id === DEMO_TRAINING.sourceId ? sessions.length : 0,
      lastSyncAt: null,
      newestSessionAt: p.id === DEMO_TRAINING.sourceId ? newestStart(sessions) : null,
      lastError: null,
    })),
  };
}

/**
 * Every training session the configured sources hold, brought up to date.
 *
 * Never throws for a source failure: a source that has never synced contributes
 * no sessions and reports its error; one that synced before keeps serving what
 * it had.
 */
export async function loadTrainingData(deps: SourceRequestDeps = {}): Promise<TrainingData> {
  const env = deps.env ?? serverEnv();
  if (readDataMode(env) !== 'live') return demoData();

  const store = processStore();
  const lookback = sourceLookbackDays(env);
  const enabled = enabledSources(env);
  const sessions: TrainingSession[] = [];

  await Promise.all(
    enabled.map(async ({ plugin, config }) => {
      store.ttlBySource.set(plugin.id, plugin.ttlMs(config));
      try {
        await store.cache.getOrLoad(plugin.id, async () => {
          try {
            const result = await plugin.sync(config, store.states.get(plugin.id) ?? null, lookback, deps);
            store.states.set(plugin.id, result.state);
            store.errors.set(plugin.id, null);
            return result.state.syncedAt;
          } catch (error) {
            store.errors.set(plugin.id, error instanceof Error ? error.message : 'The sync failed.');
            throw error;
          }
        });
      } catch {
        // Recorded above; the previous state (if any) keeps serving.
      }
    })
  );

  for (const { plugin } of enabled) {
    const state = store.states.get(plugin.id);
    if (state) sessions.push(...Object.values(state.sessions));
  }

  return { origin: 'live', sessions: sessions.sort(byStart), statuses: heldSourceStatuses(env) };
}

/** Sessions that started inside [from, to] (ISO instants, inclusive). */
export function sessionsBetween(sessions: TrainingSession[], from?: string, to?: string): TrainingSession[] {
  return sessions.filter(s => (!from || s.startTime >= from) && (!to || s.startTime <= to));
}

/** The exercise catalogue of every configured source (or the demo catalogue). */
export async function loadExerciseTemplates(deps: SourceRequestDeps = {}): Promise<ExerciseTemplateInfo[]> {
  const env = deps.env ?? serverEnv();
  if (readDataMode(env) !== 'live') return DEMO_TRAINING.templates;
  await loadTrainingData(deps);
  const store = processStore();
  const out: ExerciseTemplateInfo[] = [];
  for (const { plugin } of enabledSources(env)) {
    const templates = store.states.get(plugin.id)?.templates;
    if (templates) out.push(...Object.values(templates));
  }
  return out;
}

/** Status of every registered source without starting a sync (pipeline panel). */
export function heldSourceStatuses(env: NodeJS.ProcessEnv = serverEnv()): WorkoutSourceStatus[] {
  if (readDataMode(env) !== 'live') return demoData().statuses;
  const store = processStore();
  const enabled = enabledSources(env);
  return WORKOUT_SOURCE_PLUGINS.map(plugin => {
    const source = enabled.find(e => e.plugin.id === plugin.id);
    const state = store.states.get(plugin.id);
    const held = source && state ? Object.values(state.sessions) : [];
    return {
      id: plugin.id,
      displayName: plugin.displayName,
      envVars: plugin.envVars.map(name => configVarName(name)),
      configured: Boolean(source),
      host: source ? plugin.host(source.config) : null,
      origin: source ? 'live' : 'none',
      sessions: held.length,
      lastSyncAt: state?.syncedAt ?? null,
      newestSessionAt: newestStart(held),
      lastError: source ? store.errors.get(plugin.id) ?? null : null,
    };
  });
}
