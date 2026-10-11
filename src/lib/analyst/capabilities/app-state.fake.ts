// ── Fakes for the profile, preferences, briefing and dashboard capabilities ─
//
// Values that must NOT reach the model (a name, a host, an engine label) are in
// every fixture, so a leak is findable by searching the serialized result.

import type { BriefingView } from '../../briefing/types';
import type { CardRecord } from '../../dashboard/types';
import type { PreferencesState } from '../../prefs/store';
import { defaultProfile, type VitalProfile } from '../../profile/types';
import type { ProfileState } from '../../profile/store';
import { addDays } from '../../analytics/windows';
import { HOST, MAPS, NAME, coverageOf, PIPELINE, QUALITY } from './app-status.fake';
import { healthyReaders } from './app.fake';
import type { AppReaders } from './reads/app-readers';
import { REF } from './test-dataset.fake';

export const PROFILE: VitalProfile = { ...defaultProfile('America/Chicago'), name: NAME, dateOfBirth: '1986-06-12', sex: 'female', notes: 'A beta blocker keeps my resting heart rate low.' };
export const profileState = (profile: VitalProfile = PROFILE, over: Partial<ProfileState> = {}): ProfileState => ({ profile, stored: true, backend: 'postgres', path: `postgres://${HOST}/vital`, revision: 3, updatedAt: '2026-08-01T10:00:00.000Z', error: null, ...over });

export const prefsState = (units: 'metric' | 'imperial' = 'imperial', over: Partial<PreferencesState> = {}): PreferencesState => ({
  preferences: { theme: 'dark', lightTheme: 'a', darkTheme: 'b', units, notifications: { dailyBriefing: true, weeklyReport: false, staleData: true }, schemaVersion: 1, revision: 2, updatedAt: '2026-08-01T10:00:00.000Z' },
  stored: true,
  backend: 'postgres',
  path: `postgres://${HOST}/vital`,
  error: null,
  ...over,
});

export const BRIEFING: BriefingView = {
  kind: 'model',
  headline: 'A steady week.',
  body: 'Resting heart rate sat close to your own baseline.',
  recommendations: ['Keep your bedtime steady.'],
  attribution: 'Written by test-model',
  model: 'test-model',
  provider: 'a hosted provider label',
  destination: HOST,
  engine: 'local',
  engineDetail: `Resolved at ${HOST}`,
  generatedAt: `${REF}T07:00:00.000Z`,
  latencyMs: 900,
  traceability: { checked: 4, unmatched: [] },
  adjustments: [],
  reason: null,
  contextVersion: 1,
  contextTokens: 1200,
  asOf: `${addDays(REF, -1)}T18:00:00.000Z`,
  coversDay: REF,
  scheduledHour: 6,
  pending: false,
  cached: true,
};

export const CARDS: CardRecord[] = [
  { id: 'card-1', type: 'value', spec: { metricId: 'step_count', date: { kind: 'yesterday' } }, schemaVersion: 1, layout: { w: 1, h: 1, order: 0 }, revision: 1, createdAt: 'x', updatedAt: 'x', status: 'ok' },
  { id: 'card-2', type: 'value', spec: { metricId: 'resting_heart_rate', date: { kind: 'range', start: '2026-09-01', end: '2026-09-07' } }, schemaVersion: 1, layout: { w: 2, h: 1, order: 1 }, revision: 1, createdAt: 'x', updatedAt: 'x', status: 'ok' },
  { id: 'card-3', type: 'future', spec: null, schemaVersion: 9, layout: { w: 1, h: 1, order: 2 }, revision: 1, createdAt: 'x', updatedAt: 'x', status: 'unreadable', problem: `Cannot read ${HOST}` },
];

/** Readers for these fixtures, over the healthy ones of the first group. */
export function statusReaders(over: Partial<AppReaders> = {}): Partial<AppReaders> {
  return {
    maps: async () => MAPS,
    coverage: async req => coverageOf({}, req.bbox.south === MAPS[0].bbox.south ? 7 : 0),
    quality: async () => QUALITY,
    pipeline: async () => PIPELINE,
    profile: async () => profileState(),
    preferences: async () => prefsState(),
    activeGoal: async () => null,
    briefing: () => BRIEFING,
    dashboard: async () => ({ mode: 'live', cards: CARDS }),
    ...over,
  };
}

/** Every reader working: the first group's and these. */
export const allReaders = (over: Partial<AppReaders> = {}): Partial<AppReaders> => ({ ...healthyReaders(), ...statusReaders(), ...over });
