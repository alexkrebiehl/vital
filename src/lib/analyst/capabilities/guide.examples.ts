// ── Example calls (design §4.3) ─────────────────────────────
//
// What `list_capabilities` shows for one capability: the arguments of its tool, twice
// (once when it takes none). Written once, here. A test checks every example against
// the tool's own schema, so an example cannot teach a call the tool refuses.

type Call = Record<string, unknown>;

const app = (capability: string, params?: Call): Call => ({ capability, ...(params ? { params } : {}) });

export const EXAMPLES: Record<string, readonly Call[]> = {
  'metrics.summary': [{ metrics: ['resting_heart_rate'], days: 30 }, { metrics: ['step_count', 'sleep_analysis'], days: 7, series: false }],
  'metrics.compare': [
    { metric: 'resting_heart_rate', aStart: '2026-01-01', aEnd: '2026-01-31', bStart: '2026-02-01', bEnd: '2026-02-28' },
    { metric: 'step_count', aStart: '2026-03-01', aEnd: '2026-03-07', bStart: '2026-03-08', bEnd: '2026-03-14' },
  ],
  'metrics.series': [
    { metrics: ['resting_heart_rate'], window: { lastDays: 90 } },
    { metrics: ['step_count'], window: { month: '2026-03' }, granularity: 'week', compareTo: 'none' },
  ],
  'metrics.relationship': [{ x: 'hrv_rmssd_sleep', y: 'resting_heart_rate', window: { lastDays: 180 } }, { x: 'step_count', y: 'sleep_analysis', lagDays: 1 }],
  'workouts.sessions': [{ window: { lastDays: 30 } }, { window: { month: '2026-03' }, type: 'Running', sort: 'distance', limit: 5 }],
  'workouts.summary': [{ view: 'summary', window: { lastDays: 365 } }, { view: 'summary', window: { month: '2026-03' }, type: 'Running' }],
  'sleep.nights': [{ window: { lastDays: 14 } }, { window: { lastDays: 365 }, sort: 'deep', limit: 10 }],
  'sleep.summary': [{ view: 'summary', window: { lastDays: 365 } }, { view: 'summary', window: { month: '2026-03' } }],
  'heart.blood_pressure': [{ window: { lastDays: 30 } }, { view: 'summary', window: { lastDays: 365 } }],
  'labs.series': [{ category: 'Lipids' }, { analytes: ['ldl_cholesterol'], history: true }],
  'labs.compare': [{ dateA: '2026-01-10', dateB: '2026-06-10' }, { dateA: '2026-01-10', dateB: '2026-06-10', category: 'Lipids', changedOnly: true }],
  'medications.summary': [{ view: 'summary', window: { lastDays: 90 } }, { view: 'summary', window: { month: '2026-03' }, name: 'vitamin' }],
  'medications.doses': [{ view: 'doses', window: { lastDays: 14 } }, { view: 'doses', window: { day: '2026-03-10' }, limit: 20 }],
  'training.progress': [{}, { pathId: 'push' }],
  'training.plan': [{}],
  'training.sessions': [{ days: 42 }, { start: '2026-03-01', end: '2026-03-31', exercise: 'pull' }],
  'training.exercise_templates': [{ query: 'pull up' }, { query: 'squat' }],
  'training.reference_plans': [{ id: 'strength' }, { id: 'calisthenics' }],
  'labs.documents': [app('labs.documents')],
  'body.goal': [app('body.goal')],
  'body.nutrition_adherence': [app('body.nutrition_adherence', { window: { lastDays: 28 } }), app('body.nutrition_adherence', { window: { month: '2026-03' }, limit: 30 })],
  'insights.current': [app('insights.current')],
  'insights.reports': [app('insights.reports', { kind: 'weekly', count: 4 }), app('insights.reports', { kind: 'monthly', count: 3 })],
  'activity.coverage': [app('activity.coverage', { window: { lastDays: 90 } }), app('activity.coverage', { window: { month: '2026-03' } })],
  'activity.maps': [app('activity.maps')],
  'app.data_quality': [app('app.data_quality')],
  'app.pipeline': [app('app.pipeline')],
  'app.profile': [app('app.profile')],
  'app.preferences': [app('app.preferences')],
  'app.briefing': [app('app.briefing')],
  'app.dashboard': [app('app.dashboard')],
  'training.workout_template': [app('training.workout_template', { templateId: 'workout-a' }), app('training.workout_template', { templateId: 'workout-b' })],
};
