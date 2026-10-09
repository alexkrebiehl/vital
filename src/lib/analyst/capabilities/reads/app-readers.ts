// ── The readers behind get_app_data (SERVER ONLY) ───────────────────────────
//
// Each entry is the server function a page or route already calls, taken as it is
// (design §3.3). A test replaces any of them through `ctx.app`; production uses
// these. Nothing is held between calls: every read goes to the store again, so a
// removed source or a changed setting shows on the next question.

import { loadGoalReport, loadGoalSummary } from '../../../body-goal/server';
import type { BodyGoalReport } from '../../../body-goal/report';
import type { BodyGoalSummary } from '../../../body-goal/summary';
import { resolveDatabaseConfig } from '../../../db/config';
import { listReports, storeClient, type ReportSummary } from '../../../db/lab-store';
import type { UnitSystem } from '../../../prefs';
import type { CapabilityContext } from '../types';

export interface AppReaders {
  /** Whether a database is configured at all (so a store read can be told from "nothing stored"). */
  databaseConfigured(env: NodeJS.ProcessEnv): boolean;
  /** The stored lab documents, newest first; null when no store is configured. */
  labReports(env: NodeJS.ProcessEnv): Promise<ReportSummary[] | null>;
  /** The active goal's summary over the dataset, null with no goal; throws when it cannot be read. */
  goalSummary(system: UnitSystem, env: NodeJS.ProcessEnv): Promise<BodyGoalSummary | null>;
  /** The active goal's whole report over the dataset, null with no goal; throws when it cannot be read. */
  goalReport(system: UnitSystem, env: NodeJS.ProcessEnv): Promise<BodyGoalReport | null>;
}

export const DEFAULT_READERS: AppReaders = {
  databaseConfigured: env => resolveDatabaseConfig(env).configured,
  labReports: async env => {
    const client = storeClient(env);
    return client ? listReports(client) : null;
  },
  goalSummary: loadGoalSummary,
  goalReport: loadGoalReport,
};

/** The readers of one question: the real ones, with any test replacement over them. */
export const readersOf = (ctx: Pick<CapabilityContext, 'app'>): AppReaders => ({ ...DEFAULT_READERS, ...ctx.app });
