// ── Analyst tool: small app state (SERVER ONLY) ─────────────────────────────
//
// One tool for the small, non-time-series things the app holds: the goal, the
// insights, the status of the data, the profile. The capability names are the
// manifest's (so the enum cannot drift from the registry); each capability brings its
// own parameter schema, checked here before it reads. The registry is read at call
// time, not at load, because it imports the tools that import this file.

import { CAPABILITY_MANIFEST } from '../capabilities/manifest';
import { capabilitiesForTool } from '../capabilities/registry';
import { invalidArgs, type Envelope } from '../capabilities/envelope';
import { NO_PARAMS } from '../capabilities/reads/app-common';
import { checkArgs } from './args';
import { runCapability } from './capability-tool';
import type { AnalystTool } from './index';

export const APP_DATA_TOOL = 'get_app_data';
const IDS: string[] = CAPABILITY_MANIFEST.filter(e => e.tool === APP_DATA_TOOL).map(e => e.id);

export const getAppData: AnalystTool = {
  name: APP_DATA_TOOL,
  kind: 'read',
  description:
    'Small app state, one capability per call: lab documents, body goal, nutrition adherence, insights, reports, activity coverage, saved maps, data quality, pipeline and sources, profile, preferences, briefing, dashboard, workout template.',
  parameters: {
    type: 'object',
    required: ['capability'],
    properties: {
      capability: { type: 'string', enum: IDS },
      params: { type: 'object', description: 'insights.reports {kind, count}; body.nutrition_adherence, activity.coverage {window}; training.workout_template {templateId}.' },
    },
    additionalProperties: false,
  },
  run: (args, ctx) =>
    runCapability(ctx, async (cctx): Promise<Envelope<unknown>> => {
      const cap = capabilitiesForTool(APP_DATA_TOOL).find(c => c.id === args.capability);
      if (!cap) return invalidArgs({ id: APP_DATA_TOOL }, [`capability must be one of: ${IDS.join(', ')}.`]);
      const params = (args.params ?? {}) as Record<string, unknown>;
      const problems = checkArgs(cap.params ?? NO_PARAMS, params, 'params');
      if (problems.length) return invalidArgs(cap, problems);
      return cap.read(params, cctx);
    }),
};
