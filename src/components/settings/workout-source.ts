// ── Workout sources card: the sync line and which source has a form ─────────
//
// Each source in the pipeline report gets one card under Settings → Connections →
// Workout sources. The card's sync line is derived from the report alone; a
// source that has a connection form shows the form in the same card.

import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';

export type SyncTone = 'neutral' | 'muted' | 'warning';

export interface SyncLine {
  text: string;
  tone: SyncTone;
}

/** Source ids that have a connection form (key, optional URL, Change, Disconnect). */
const SOURCES_WITH_FORM: ReadonlySet<string> = new Set(['hevy']);

export function hasConnectionForm(sourceId: string): boolean {
  return SOURCES_WITH_FORM.has(sourceId);
}

/** The one-line sync state of a source: host, sessions, last sync, last error. */
export function workoutSourceLine(source: WorkoutSourceStatus): SyncLine {
  if (source.origin === 'demo') return { text: `Demo sessions (${source.sessions})`, tone: 'neutral' };
  if (!source.configured) return { text: 'Not connected', tone: 'muted' };
  if (source.lastError) return { text: `Error: ${source.lastError}`, tone: 'warning' };
  const synced = source.lastSyncAt ? ` · synced ${source.lastSyncAt.slice(0, 16).replace('T', ' ')} UTC` : '';
  return {
    text: `Connected (${source.host ?? 'host unknown'}) · ${source.sessions} session${source.sessions === 1 ? '' : 's'}${synced}`,
    tone: 'neutral',
  };
}
