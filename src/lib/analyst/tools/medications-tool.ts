// ── Analyst tool: the medication log (SERVER ONLY) ──────
//
// A thin tool over the medications capabilities: the work, the wording of the
// statuses and the scrubbing are in capabilities/reads. The description keeps the
// two sentences that say what the log is and forbid advice, word for word.

import { MAX_LIMIT } from '../capabilities/reads/medications';
import { readMedicationDoses, readMedicationSummary } from '../capabilities/reads/medications';
import { MAX_NAME } from '../capabilities/reads/medications-select';
import { MAX_WINDOW_DAYS, WINDOW_SCHEMA } from '../capabilities/window';
import { runCapability } from './capability-tool';
import type { AnalystTool } from './index';

export const getMedications: AnalystTool = {
  name: 'get_medications',
  kind: 'read',
  description:
    'The medication log in a window. view "summary" (default): per medication, the dose records, days, last day, and how many were taken, skipped or unknown. view "doses": each logged dose with day, local time, medication, dose as logged and status. It is a RECORD of what was logged, not a treatment plan and not known to be complete. Never advise on starting, stopping or changing a dose from it.',
  parameters: {
    type: 'object',
    properties: {
      window: { ...WINDOW_SCHEMA, description: 'Default: the last 30 days.' },
      view: { type: 'string', enum: ['summary', 'doses'], description: 'summary or doses.' },
      name: { type: 'string', maxLength: MAX_NAME, description: 'Only this medication (part of its name).' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Doses per call.' },
      offset: { type: 'integer', minimum: 0, description: 'Use page.nextOffset.' },
      days: { type: 'integer', minimum: 1, maximum: MAX_WINDOW_DAYS, description: 'Same as window.lastDays.' },
    },
    additionalProperties: false,
  },
  run: (args, ctx) => runCapability(ctx, c => (args.view === 'doses' ? readMedicationDoses(args, c) : readMedicationSummary(args, c))),
};
