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
  limit: { type: 'integer' as const, minimum: 1, maximum: max, description: `Rows per call, at most ${max}.` },
  offset: { type: 'integer' as const, minimum: 0, description: 'Skip this many rows; use page.nextOffset to read on.' },
});

export const getWorkouts: AnalystTool = {
  name: 'get_workouts',
  kind: 'read',
  description:
    'The recorded workouts in a window. view "sessions" (default) lists each one: date, start and end time, type, duration, and distance, calories and heart rate when recorded, newest first. view "summary" rolls the window up: totals, sessions per week, time by type and by month, the latest three. Quote the "display" strings. typesInWindow lists the types present, so a wrong type can be corrected. detail: true adds the exercises of the strength session that is the same workout.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 30 days'),
      view: { type: 'string', enum: ['sessions', 'summary'], description: 'sessions (default) or summary.' },
      type: { type: 'string', maxLength: 60, description: 'An activity type as recorded, e.g. "Running", any letter case. Omit for all.' },
      sort: { type: 'string', enum: WORKOUT_SORTS, description: 'date (default), duration, calories or distance.' },
      order: { type: 'string', enum: ORDERS, description: 'desc (default) or asc.' },
      detail: { type: 'boolean', description: 'Attach the matching strength session\'s exercises. Default false.' },
      ...paging(WORKOUT_MAX),
      days: { type: 'integer', minimum: 1, maximum: 730, description: 'The last N days; the same as window.lastDays.' },
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => (args.view === 'summary' ? readWorkoutSummary(args, c) : readWorkoutSessions(args, c))),
};

export const getSleep: AnalystTool = {
  name: 'get_sleep',
  kind: 'read',
  description:
    'Sleep night by night: bedtime and wake time, time asleep and in bed, and the deep, core, REM and awake split. A night recorded only as time in bed has no time asleep and no stages (hasStages false). view "nights" is the default for up to 31 nights; a longer window defaults to "summary" (means by week or month, longest and shortest nights). Give a sort, e.g. deep desc with a small limit, to find the deepest nights. Quote the "display" strings.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 14 days'),
      view: { type: 'string', enum: ['nights', 'summary'], description: 'nights or summary.' },
      sort: { type: 'string', enum: SLEEP_SORTS, description: 'date (default), asleep, inBed, deep, rem, core, awake, bedtime or wake.' },
      order: { type: 'string', enum: ORDERS, description: 'desc (default) or asc.' },
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
    'Blood pressure readings in a window, each a systolic/diastolic pair, flagged against the 120/80 reference threshold (a reference, never a diagnosis); or view "summary": mean, median and range as pairs, the share above the reference, and the change against the window before. aboveReferenceOnly keeps only readings above it. Quote the "display" strings.',
  parameters: {
    type: 'object',
    properties: {
      window: window('the last 30 days'),
      view: { type: 'string', enum: ['readings', 'summary'], description: 'readings (default) or summary.' },
      aboveReferenceOnly: { type: 'boolean', description: 'Only readings above the reference threshold. Default false.' },
      ...paging(BP_MAX),
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => readBloodPressure(args, c)),
};
