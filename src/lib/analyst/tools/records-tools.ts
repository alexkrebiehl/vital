// ── Analyst tools: workouts, sleep, blood pressure (SERVER ONLY) ──
//
// Record-level reads over any window. Each is a thin tool over a capability: the
// work, the formatting and the failure statuses are in capabilities/reads.

import { readBloodPressure, MAX_LIMIT as BP_MAX } from '../capabilities/reads/blood-pressure';
import { readSleepNights, readSleepSummary } from '../capabilities/reads/sleep';
import { MAX_LIMIT as SLEEP_MAX } from '../capabilities/reads/sleep-select';
import { readWorkoutSessions } from '../capabilities/reads/workouts-sessions';
import { readWorkoutSummary } from '../capabilities/reads/workouts-summary';
import { MAX_LIMIT as WORKOUT_MAX, ORDERS, SORTS as WORKOUT_SORTS } from '../capabilities/reads/workouts-select';
import { SORTS as SLEEP_SORTS } from '../capabilities/reads/sleep-select';
import { WINDOW_SCHEMA } from '../capabilities/window';
import type { AnalystTool } from './index';
import { runCapability } from './capability-tool';

const window = (fallback: string) => ({ ...WINDOW_SCHEMA, description: `${WINDOW_SCHEMA.description} Default: ${fallback}.` });
const paging = (max: number) => ({
  limit: { type: 'integer' as const, minimum: 1, maximum: max, description: 'Rows per call.' },
  offset: { type: 'integer' as const, minimum: 0, description: 'Use page.nextOffset.' },
});

export const getWorkouts: AnalystTool = {
  name: 'get_workouts',
  kind: 'read',
  description:
    'The recorded workouts in a window. view "sessions" (default): each one with date, start and end time, type, duration, and distance, calories and heart rate when recorded, newest first. view "summary": totals, sessions per week, time by type and by month, the latest three. Quote the "display" strings. typesInWindow lists the types present. detail: true adds the exercises of the matching strength session.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 30 days'),
      view: { type: 'string', enum: ['sessions', 'summary'], description: 'sessions (default) or summary.' },
      type: { type: 'string', maxLength: 60, description: 'An activity type, e.g. "Running". Omit for all.' },
      sort: { type: 'string', enum: WORKOUT_SORTS, description: 'Default date.' },
      order: { type: 'string', enum: ORDERS, description: 'Default desc.' },
      detail: { type: 'boolean', description: 'Add the matching strength session\'s exercises.' },
      ...paging(WORKOUT_MAX),
      days: { type: 'integer', minimum: 1, maximum: 730, description: 'Same as window.lastDays.' },
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => (args.view === 'summary' ? readWorkoutSummary(args, c) : readWorkoutSessions(args, c))),
};

export const getSleep: AnalystTool = {
  name: 'get_sleep',
  kind: 'read',
  description:
    'Sleep night by night: bedtime and wake time, time asleep and in bed, and the deep, core, REM and awake split. A night recorded only as time in bed has no time asleep and no stages. view "nights" (default, up to 31 nights) or "summary" (means by week or month, longest and shortest nights). Sort, e.g. deep desc with a small limit, finds the deepest nights.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 14 days'),
      view: { type: 'string', enum: ['nights', 'summary'], description: 'nights or summary.' },
      sort: { type: 'string', enum: SLEEP_SORTS, description: 'Default date.' },
      order: { type: 'string', enum: ORDERS, description: 'Default desc.' },
      ...paging(SLEEP_MAX),
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => (args.view === 'summary' ? readSleepSummary(args, c) : readSleepNights(args, c))),
};

export const getBloodPressure: AnalystTool = {
  name: 'get_blood_pressure',
  kind: 'read',
  description:
    'Blood pressure readings in a window, each a systolic/diastolic pair flagged against the 120/80 reference threshold (a reference, never a diagnosis); view "summary": mean, median and range as pairs, share above the reference, change against the window before. Quote the "display" strings.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 30 days'),
      view: { type: 'string', enum: ['readings', 'summary'], description: 'readings (default) or summary.' },
      aboveReferenceOnly: { type: 'boolean', description: 'Only readings above the reference.' },
      ...paging(BP_MAX),
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => readBloodPressure(args, c)),
};
