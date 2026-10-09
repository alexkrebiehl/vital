// ── The calls the budget test measures ──────────────────────────────────────
//
// (training.sessions is not here: it reads the plan store, which these tests do not open;
// it is capped at 40 sessions and measured in training-sessions.test.ts.)
//
// One entry per capability that returns rows, at its default limit and (where the
// maximum is larger) at its maximum, over the widest window the tool takes. The
// budget test runs each through runTool, as the model's call would.

export interface BudgetCall {
  label: string;
  /** The capability this call exercises. */
  capability: string;
  tool: string;
  args: Record<string, unknown>;
  /** True when this call asks for the capability's maximum limit. */
  max: boolean;
}

const WIDE = { window: { lastDays: 400 } };
// Windows short enough that the rows page (a year is summarised first, design §8) and the limit binds.
const NIGHTS = { view: 'nights', window: { lastDays: 60 } };
const DOSES = { view: 'doses', window: { lastDays: 60 } };
const METRICS = ['step_count', 'heart_rate_variability', 'resting_heart_rate'];

const call = (capability: string, tool: string, args: Record<string, unknown>, max = false, note = ''): BudgetCall => ({
  label: `${tool} ${capability} ${max ? 'at max limit' : 'at default limit'}${note}`,
  capability,
  tool,
  args,
  max,
});

export const BUDGET_CALLS: readonly BudgetCall[] = [
  call('metrics.series', 'get_metric_series', { metrics: METRICS, ...WIDE }),
  call('metrics.series', 'get_metric_series', { metrics: METRICS, window: { lastDays: 92 }, granularity: 'day' }, true),
  call('metrics.relationship', 'get_metric_relationship', { x: 'step_count', y: 'heart_rate_variability', days: 365 }),
  call('workouts.sessions', 'get_workouts', WIDE),
  call('workouts.sessions', 'get_workouts', { ...WIDE, limit: 25 }, true),
  call('workouts.summary', 'get_workouts', { ...WIDE, view: 'summary' }),
  call('sleep.nights', 'get_sleep', NIGHTS),
  call('sleep.nights', 'get_sleep', { ...NIGHTS, limit: 31 }, true),
  call('sleep.summary', 'get_sleep', { ...WIDE, view: 'summary' }),
  call('heart.blood_pressure', 'get_blood_pressure', WIDE),
  call('heart.blood_pressure', 'get_blood_pressure', { ...WIDE, limit: 100 }, true),
  call('medications.doses', 'get_medications', DOSES),
  call('medications.doses', 'get_medications', { ...DOSES, limit: 100 }, true),
  call('medications.summary', 'get_medications', { ...WIDE, view: 'summary' }),
  call('labs.series', 'get_lab_results', { analytes: ['ldl', 'hemoglobin', 'alt'], history: true }),
  call('labs.compare', 'compare_lab_panels', { dateA: '2026-03-10', dateB: '2026-09-29' }),
  call('labs.documents', 'get_app_data', { capability: 'labs.documents' }),
  call('body.nutrition_adherence', 'get_app_data', { capability: 'body.nutrition_adherence', params: { window: { lastDays: 400 } } }),
  call('body.nutrition_adherence', 'get_app_data', { capability: 'body.nutrition_adherence', params: { window: { lastDays: 400 }, limit: 60 } }, true),
  call('insights.reports', 'get_app_data', { capability: 'insights.reports', params: { kind: 'weekly' } }),
  call('insights.reports', 'get_app_data', { capability: 'insights.reports', params: { kind: 'weekly', count: 12 } }, true),
];
