// ── Analyst tool: metric series (SERVER ONLY) ───────────

import { readMetricSeries, MAX_SERIES_METRICS } from '../capabilities/reads/metric-series';
import { GRANULARITIES } from '../capabilities/reads/series-points';
import { WINDOW_SCHEMA } from '../capabilities/window';
import type { AnalystTool } from './index';
import { runCapability } from './capability-tool';

export const getMetricSeries: AnalystTool = {
  name: 'get_metric_series',
  kind: 'read',
  description:
    `One to ${MAX_SERIES_METRICS} daily health metrics over any window: a summary (mean, median, min, max, latest), the points by day, week or month, and the change against the window before (or one you name). Every value has a "display" string: quote those, never re-derive a number. Sleep minutes are metric sleep_analysis; sleep stages and bedtimes are get_sleep, blood pressure is get_blood_pressure. Steps and other daily totals leave out the day still in progress.`,
  parameters: {
    type: 'object',
    required: ['metrics'],
    properties: {
      metrics: { type: 'array', items: { type: 'string' }, maxItems: MAX_SERIES_METRICS, description: 'Metric ids from the index, e.g. "resting_heart_rate".' },
      window: { ...WINDOW_SCHEMA, description: `${WINDOW_SCHEMA.description} Default: the last 30 days.` },
      granularity: { type: 'string', enum: GRANULARITIES, description: 'auto (default): days up to 92 points, then weeks, then months. summary: no points.' },
      compareTo: { description: '"previous" (default), "none", or { start, end }.' },
      offset: { type: 'integer', minimum: 0, description: 'Use page.nextOffset.' },
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, cctx => readMetricSeries(args, cctx)),
};
