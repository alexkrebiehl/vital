// ── Hevy workout-source plugin ──────────────────────────
//
// Sync strategy:
//
//   first sync    page /v1/workouts (newest first) back to the lookback cut-off,
//                 and read the exercise catalogue once (for muscle groups and to
//                 tell assisted from weighted exercises).
//   later syncs   /v1/workouts/events?since=<last sync start> — Hevy's own
//                 change feed — applying `updated` and `deleted` events to the
//                 held sessions. Only sessions touched since then are read.
//
// `since` is the instant the previous sync *started*, less a small overlap, so a
// workout saved while a sync was running is picked up by the next one. Applying
// an update twice is harmless: sessions are keyed by id.

import type {
  ExerciseTemplateInfo,
  SourceRequestDeps,
  SourceSyncResult,
  SourceSyncState,
  TrainingSession,
  WorkoutSourcePlugin,
} from '../types';
import {
  fetchExerciseTemplates,
  fetchWorkoutEvents,
  fetchWorkoutsSince,
  hevyGet,
  hevyHost,
  HevyError,
  readHevyConfig,
  type HevyConfig,
} from './client';
import { HEVY_SOURCE_ID, normalizeTemplate, normalizeWorkout, sessionId } from './normalize';

/** Overlap between one sync's start and the next sync's `since`. */
export const HEVY_SYNC_OVERLAP_MS = 5 * 60_000;

async function loadTemplates(
  config: HevyConfig,
  deps: SourceRequestDeps
): Promise<Record<string, ExerciseTemplateInfo>> {
  try {
    const wire = await fetchExerciseTemplates(config, deps);
    const out: Record<string, ExerciseTemplateInfo> = {};
    for (const t of wire) {
      const info = normalizeTemplate(t);
      if (info) out[info.id] = info;
    }
    return out;
  } catch (error) {
    // The catalogue only enriches sessions; sessions without it still carry
    // names and sets. A bad key fails the workouts call too, so that is where
    // the error is reported.
    if (error instanceof HevyError && error.kind === 'unauthorized') throw error;
    return {};
  }
}

function prune(sessions: Record<string, TrainingSession>, cutoffMs: number): Record<string, TrainingSession> {
  const out: Record<string, TrainingSession> = {};
  for (const [id, s] of Object.entries(sessions)) {
    if (Date.parse(s.startTime) >= cutoffMs) out[id] = s;
  }
  return out;
}

export async function syncHevy(
  config: HevyConfig,
  previous: SourceSyncState | null,
  lookbackDays: number,
  deps: SourceRequestDeps = {}
): Promise<SourceSyncResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const cutoffMs = startedAt - lookbackDays * 86_400_000;

  if (!previous?.syncedAt) {
    const templates = await loadTemplates(config, deps);
    const wire = await fetchWorkoutsSince(config, new Date(cutoffMs).toISOString(), deps);
    const sessions: Record<string, TrainingSession> = {};
    for (const w of wire) {
      const s = normalizeWorkout(w, templates);
      if (s) sessions[s.id] = s;
    }
    return {
      mode: 'full',
      read: wire.length,
      state: {
        sessions,
        syncedAt: new Date(startedAt).toISOString(),
        coveredFrom: new Date(cutoffMs).toISOString(),
        templates,
      },
    };
  }

  const since = new Date(Date.parse(previous.syncedAt) - HEVY_SYNC_OVERLAP_MS).toISOString();
  const events = await fetchWorkoutEvents(config, since, deps);
  let templates = previous.templates ?? {};

  // A workout using an exercise created since the catalogue was read: refresh it once.
  const unknownTemplate = events.some(
    e =>
      e.type === 'updated' &&
      (e.workout.exercises ?? []).some(x => x.exercise_template_id && !templates[x.exercise_template_id])
  );
  if (unknownTemplate) {
    const fresh = await loadTemplates(config, deps);
    if (Object.keys(fresh).length > 0) templates = fresh;
  }

  const sessions = { ...previous.sessions };
  // Events arrive newest first; apply oldest first so the newest state wins.
  for (const event of [...events].reverse()) {
    if (event.type === 'deleted' && event.id) {
      delete sessions[sessionId(event.id)];
    } else if (event.type === 'updated' && event.workout) {
      const s = normalizeWorkout(event.workout, templates);
      if (s) sessions[s.id] = s;
    }
  }

  return {
    mode: 'incremental',
    read: events.length,
    state: {
      sessions: prune(sessions, cutoffMs),
      syncedAt: new Date(startedAt).toISOString(),
      coveredFrom: new Date(cutoffMs).toISOString(),
      templates,
    },
  };
}

export const hevyPlugin: WorkoutSourcePlugin<HevyConfig> = {
  id: HEVY_SOURCE_ID,
  displayName: 'Hevy',
  readConfig: deps => readHevyConfig(deps),
  host: config => hevyHost(config),
  ttlMs: config => config.ttlSeconds * 1000,

  async probe(config, deps) {
    const now = deps.now ?? Date.now;
    const started = now();
    try {
      await hevyGet(config, '/v1/user/info', deps);
      return { ok: true, durationMs: now() - started, detail: 'GET /v1/user/info answered.', httpStatus: 200 };
    } catch (error) {
      const e = error instanceof HevyError ? error : new HevyError('The Hevy probe failed.', 'network_error');
      return { ok: false, durationMs: now() - started, detail: e.message, httpStatus: e.httpStatus };
    }
  },

  sync: syncHevy,

  async listExerciseTemplates(config, deps) {
    return Object.values(await loadTemplates(config, deps));
  },
};
