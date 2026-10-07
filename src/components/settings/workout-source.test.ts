// ── Workout sources card: the sync line and which source has a form ─────────

import { describe, expect, it } from 'vitest';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { hasConnectionForm, workoutSourceLine } from './workout-source';

const BASE: WorkoutSourceStatus = {
  id: 'sample-source',
  displayName: 'Sample source',
  configured: true,
  host: 'sample.invalid',
  origin: 'live',
  sessions: 3,
  lastSyncAt: '2026-01-02T03:04:05.000Z',
  newestSessionAt: null,
  lastError: null,
};

describe('workoutSourceLine', () => {
  it('connected: host, session count and last sync', () => {
    expect(workoutSourceLine(BASE)).toEqual({
      text: 'Connected (sample.invalid) · 3 sessions · synced 2026-01-02 03:04 UTC',
      tone: 'neutral',
    });
  });

  it('one session is singular and a missing sync time is left out', () => {
    const line = workoutSourceLine({ ...BASE, sessions: 1, lastSyncAt: null, host: null });
    expect(line.text).toBe('Connected (host unknown) · 1 session');
  });

  it('a last error is a warning and replaces the connected text', () => {
    expect(workoutSourceLine({ ...BASE, lastError: 'Rejected the key' })).toEqual({
      text: 'Error: Rejected the key',
      tone: 'warning',
    });
  });

  it('not connected is muted', () => {
    expect(workoutSourceLine({ ...BASE, configured: false, origin: 'none' })).toEqual({
      text: 'Not connected',
      tone: 'muted',
    });
  });

  it('demo keeps its demo sessions text', () => {
    expect(workoutSourceLine({ ...BASE, configured: false, origin: 'demo', sessions: 12 })).toEqual({
      text: 'Demo sessions (12)',
      tone: 'neutral',
    });
  });
});

describe('hasConnectionForm', () => {
  it('only the source with a connection form is keyed in', () => {
    expect(hasConnectionForm('hevy')).toBe(true);
    expect(hasConnectionForm('sample-source')).toBe(false);
  });
});
