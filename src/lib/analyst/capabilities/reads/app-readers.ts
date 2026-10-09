// ── The readers behind get_app_data (SERVER ONLY) ───────────────────────────
//
// Each entry is the server function a page or route already calls, taken as it is
// (design §3.3). A test replaces any of them through `ctx.app`; production uses
// these. Nothing is held between calls: every read goes to the store again, so a
// removed source or a changed setting shows on the next question.

import { readCoverage, type CoverageRequest, type CoverageResponse } from '../../../activity-maps/service';
import type { ActivityMap } from '../../../activity-maps/types';
import { readDataMode } from '../../../adapters/runtime';
import { peekBriefing, type BriefingDeps, type BriefingView } from '../../../briefing';
import { loadGoalReport, loadGoalSummary, readActiveBodyGoal } from '../../../body-goal/server';
import type { BodyGoalReport } from '../../../body-goal/report';
import type { BodyGoalSummary } from '../../../body-goal/summary';
import type { BodyGoal } from '../../../body-goal/types';
import { listMaps } from '../../../db/activity-maps-store';
import { resolveDatabaseConfig } from '../../../db/config';
import { dashboardClient, pgListCards } from '../../../db/dashboard-store';
import { listReports, storeClient, type ReportSummary } from '../../../db/lab-store';
import { getPool } from '../../../db/pool';
import type { CardRecord, DashboardMode } from '../../../dashboard/types';
import { readQualityResponse } from '../../../pipeline/quality-read';
import { resolvePipelineStatus } from '../../../pipeline/status';
import type { PipelineQualityResponse, PipelineStatusReport } from '../../../pipeline/types';
import type { UnitSystem } from '../../../prefs';
import { readPreferencesState, type PreferencesState } from '../../../prefs/store';
import { readProfileState, type ProfileState } from '../../../profile/store';
import type { CapabilityContext } from '../types';

/** The data-quality checks run in the background; a question waits a short while for them, not the page's 45 s. */
export const QUALITY_WAIT_MS = 8_000;

export interface AppReaders {
  /** Whether a database is configured at all (so a store read can be told from "nothing stored"). */
  databaseConfigured(env: NodeJS.ProcessEnv): boolean;
  /** The stored lab documents, newest first; null when no store is configured. */
  labReports(env: NodeJS.ProcessEnv): Promise<ReportSummary[] | null>;
  /** The active goal's summary over the dataset, null with no goal; throws when it cannot be read. */
  goalSummary(system: UnitSystem, env: NodeJS.ProcessEnv): Promise<BodyGoalSummary | null>;
  /** The active goal's whole report over the dataset, null with no goal; throws when it cannot be read. */
  goalReport(system: UnitSystem, env: NodeJS.ProcessEnv): Promise<BodyGoalReport | null>;
  /** The active goal as the briefing reads it (a goal that cannot be read is no goal). */
  activeGoal(env: NodeJS.ProcessEnv): Promise<BodyGoal | null>;
  /** The saved map areas; null when no store is configured. */
  maps(env: NodeJS.ProcessEnv): Promise<ActivityMap[] | null>;
  /** Where the workouts went inside one box, over the given days. */
  coverage(req: CoverageRequest): Promise<CoverageResponse>;
  /** The data-quality answer the page shows. */
  quality(env: NodeJS.ProcessEnv): Promise<PipelineQualityResponse>;
  /** The pipeline status report the Settings panel shows. */
  pipeline(env: NodeJS.ProcessEnv): Promise<PipelineStatusReport>;
  profile(env: NodeJS.ProcessEnv): Promise<ProfileState>;
  preferences(env: NodeJS.ProcessEnv): Promise<PreferencesState>;
  /** The briefing already written for the day, or null. Never starts one. */
  briefing(deps: BriefingDeps): BriefingView | null;
  /** The dashboard cards of the current data mode; null when no store is configured. */
  dashboard(env: NodeJS.ProcessEnv): Promise<{ mode: DashboardMode; cards: CardRecord[] } | null>;
}

export const DEFAULT_READERS: AppReaders = {
  databaseConfigured: env => resolveDatabaseConfig(env).configured,
  labReports: async env => {
    const client = storeClient(env);
    return client ? listReports(client) : null;
  },
  goalSummary: loadGoalSummary,
  goalReport: loadGoalReport,
  activeGoal: readActiveBodyGoal,
  maps: async env => {
    const pool = getPool(env);
    return pool ? listMaps(pool) : null;
  },
  coverage: readCoverage,
  quality: env => readQualityResponse({ env, waitMs: QUALITY_WAIT_MS }),
  pipeline: env => resolvePipelineStatus({ env }),
  profile: readProfileState,
  preferences: readPreferencesState,
  briefing: peekBriefing,
  dashboard: async env => {
    const client = dashboardClient(env);
    if (!client) return null;
    const mode = readDataMode(env);
    return { mode, cards: await pgListCards(client, mode) };
  },
};

/** The readers of one question: the real ones, with any test replacement over them. */
export const readersOf = (ctx: Pick<CapabilityContext, 'app'>): AppReaders => ({ ...DEFAULT_READERS, ...ctx.app });
