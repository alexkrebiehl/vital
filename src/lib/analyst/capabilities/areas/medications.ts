// ── Capabilities: medications (SERVER ONLY) ─────────────

import type { Capability } from '../types';
import { manifestEntry } from '../manifest';
import { readThrough, type SourceDown } from './legacy';

type Args = Record<string, unknown>;

const medsDown: SourceDown = async (_ctx, content) => content.available === false;

export const summary: Capability<Args, unknown> = {
  ...manifestEntry('medications.summary'),
  description: 'The medication log for the last N days, per medication: dose records, days, last day, taken, skipped or unknown. A record of what was logged, not a treatment plan.',
  owner: 'medications-upstream',
  mirrors: { routes: ['GET /api/medications'], pages: ['/medications'] },
  time: 'window',
  sizeClass: 'small',
  absenceTerms: ['no medication records', 'no doses logged', 'no dose records', 'not taking'],
  async coverage() {
    return { kind: 'unknown', reason: 'only the medication log itself can say how far back it goes; read it to find out' };
  },
  read: (args, ctx) => readThrough(summary, medsDown)(args, ctx),
};
