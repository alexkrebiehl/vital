// ── The capability manifest (design §3) ─────────────────
//
// CLIENT-SAFE: this file imports nothing but ./types. It lists what the analyst
// can reach, by id, with the words the client shows while a lookup runs. The
// server half of each entry (description, coverage, read) lives in areas/*.ts
// and is joined to these entries by registry.ts.
//
// The status lines of the data tools are the ones the answer view shows today.

import type { CapabilityManifestEntry } from './types';

/**
 * Every get_app_data capability shares one status line and one source tag: sources are
 * tagged per TOOL (a turn records the tool, not the capability), and a tool with several
 * tags is read as opaque. So the configuration-only capabilities are over-tagged with every
 * active source: removing one deletes more conversations, never fewer (design §13).
 */
const APP_DATA_STATUS = 'Looking up your app data…';
const APP_DATA_SOURCES = 'metric-provenance';

export const CAPABILITY_MANIFEST: CapabilityManifestEntry[] = [
  {
    id: 'metrics.summary',
    area: 'metrics',
    title: 'Metric summaries',
    tool: 'get_metrics',
    statusLabel: 'Looking up your metrics…',
    sources: 'metric-provenance',
    category: 'metric-summaries',
  },
  {
    id: 'metrics.compare',
    area: 'metrics',
    title: 'Period comparison',
    tool: 'compare_periods',
    statusLabel: 'Comparing two periods…',
    sources: 'metric-provenance',
    category: 'metric-summaries',
  },
  {
    id: 'metrics.series',
    area: 'metrics',
    title: 'Metric series',
    tool: 'get_metric_series',
    statusLabel: 'Looking up your metric series…',
    sources: 'metric-provenance',
    category: 'metric-summaries',
  },
  {
    id: 'metrics.relationship',
    area: 'metrics',
    title: 'Metric relationship',
    tool: 'get_metric_relationship',
    statusLabel: 'Checking how two metrics move together…',
    sources: 'metric-provenance',
    category: 'metric-summaries',
  },
  {
    id: 'workouts.sessions',
    area: 'workouts',
    title: 'Workout sessions',
    tool: 'get_workouts',
    statusLabel: 'Looking up your workouts…',
    sources: 'all-health',
    category: 'workouts',
  },
  {
    id: 'workouts.summary',
    area: 'workouts',
    title: 'Workout summary',
    tool: 'get_workouts',
    statusLabel: 'Looking up your workouts…',
    sources: 'all-health',
    category: 'workouts',
  },
  {
    id: 'sleep.nights',
    area: 'sleep',
    title: 'Sleep nights',
    tool: 'get_sleep',
    statusLabel: 'Looking up your sleep…',
    sources: 'metric-provenance',
    category: 'sleep-nights',
  },
  {
    id: 'sleep.summary',
    area: 'sleep',
    title: 'Sleep summary',
    tool: 'get_sleep',
    statusLabel: 'Looking up your sleep…',
    sources: 'metric-provenance',
    category: 'sleep-nights',
  },
  {
    id: 'heart.blood_pressure',
    area: 'heart',
    title: 'Blood pressure',
    tool: 'get_blood_pressure',
    statusLabel: 'Looking up your blood pressure…',
    sources: 'metric-provenance',
    category: 'blood-pressure',
  },
  {
    id: 'labs.series',
    area: 'labs',
    title: 'Lab results',
    tool: 'get_lab_results',
    statusLabel: 'Looking up your lab results…',
    sources: 'lab',
    category: 'lab-results',
  },
  {
    id: 'labs.compare',
    area: 'labs',
    title: 'Lab panel comparison',
    tool: 'compare_lab_panels',
    statusLabel: 'Comparing your lab panels…',
    sources: 'lab',
    category: 'lab-results',
  },
  {
    id: 'medications.summary',
    area: 'medications',
    title: 'Medication log',
    tool: 'get_medications',
    statusLabel: 'Looking up your medication log…',
    sources: 'hae',
    category: 'medication-records',
  },
  {
    id: 'medications.doses',
    area: 'medications',
    title: 'Medication doses',
    tool: 'get_medications',
    statusLabel: 'Looking up your medication log…',
    sources: 'hae',
    category: 'medication-records',
  },
  {
    id: 'training.progress',
    area: 'training',
    title: 'Training progress',
    tool: 'get_routine_progress',
    statusLabel: 'Using the plan tool: get routine progress…',
    sources: 'workout-detail',
    category: 'strength-sessions',
  },
  {
    id: 'training.plan',
    area: 'training',
    title: 'Training plan',
    tool: 'get_training_plan',
    statusLabel: 'Using the plan tool: get training plan…',
    sources: 'configuration',
    category: 'app-status',
  },
  {
    id: 'training.sessions',
    area: 'training',
    title: 'Training sessions',
    tool: 'get_training_sessions',
    statusLabel: 'Using the plan tool: get training sessions…',
    sources: 'workout-detail',
    category: 'strength-sessions',
  },
  {
    id: 'training.exercise_templates',
    area: 'training',
    title: 'Exercise catalogue',
    tool: 'search_exercise_templates',
    statusLabel: 'Using the plan tool: search exercise templates…',
    sources: 'configuration',
    category: 'app-status',
  },
  {
    id: 'training.reference_plans',
    area: 'training',
    title: 'Reference plans',
    tool: 'get_reference_plan',
    statusLabel: 'Using the plan tool: get reference plan…',
    sources: 'configuration',
    category: 'app-status',
  },
  {
    id: 'labs.documents',
    area: 'labs',
    title: 'Lab documents',
    tool: 'get_app_data',
    statusLabel: APP_DATA_STATUS,
    sources: APP_DATA_SOURCES,
    category: 'lab-results',
  },
  {
    id: 'body.goal',
    area: 'body',
    title: 'Body goal',
    tool: 'get_app_data',
    statusLabel: APP_DATA_STATUS,
    sources: APP_DATA_SOURCES,
    category: 'body-goal',
  },
  {
    id: 'body.nutrition_adherence',
    area: 'body',
    title: 'Nutrition adherence',
    tool: 'get_app_data',
    statusLabel: APP_DATA_STATUS,
    sources: APP_DATA_SOURCES,
    category: 'body-goal',
  },
  {
    id: 'insights.current',
    area: 'insights',
    title: 'Insights',
    tool: 'get_app_data',
    statusLabel: APP_DATA_STATUS,
    sources: APP_DATA_SOURCES,
    category: 'metric-summaries',
  },
  {
    id: 'insights.reports',
    area: 'insights',
    title: 'Weekly and monthly reports',
    tool: 'get_app_data',
    statusLabel: APP_DATA_STATUS,
    sources: APP_DATA_SOURCES,
    category: 'metric-summaries',
  },
];

/** One manifest entry by id; throws on a typo so an area file cannot drift from the manifest. */
export function manifestEntry(id: string): CapabilityManifestEntry {
  const entry = CAPABILITY_MANIFEST.find(e => e.id === id);
  if (!entry) throw new Error(`No manifest entry "${id}".`);
  return entry;
}
