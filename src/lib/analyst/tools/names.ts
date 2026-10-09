// The names of the read-only data tools. Kept apart from the tools themselves so the
// client can label a lookup without importing server code.

export const DATA_TOOL_NAMES = [
  'get_metrics',
  'compare_periods',
  'get_metric_series',
  'get_metric_relationship',
  'get_workouts',
  'get_sleep',
  'get_blood_pressure',
  'get_lab_results',
  'compare_lab_panels',
  'get_medications',
  'get_app_data',
] as const;

export function isDataTool(name: string): boolean {
  return (DATA_TOOL_NAMES as readonly string[]).includes(name);
}
