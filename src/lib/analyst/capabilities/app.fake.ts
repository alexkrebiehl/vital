// ── Fakes for the get_app_data capabilities ─────────────────────────────────
//
// Readers that work, return nothing, or fail with a message that carries a canary,
// and a synthetic body-goal dataset on top of the seeded one. Nothing here reads
// Postgres, a health source or a model; every date is derived from REF.

import { setActiveDataset } from '../../adapters/dataset';
import { addDays } from '../../analytics/windows';
import { goalReportFromDataset } from '../../body-goal/dataset';
import type { BodyGoal } from '../../body-goal/types';
import { bodyGoalSummary } from '../../body-goal/summary';
import type { ReportSummary } from '../../db/lab-store';
import type { HealthFixtures, MetricObservation } from '../../metrics/types';
import type { AppReaders } from './reads/app-readers';
import { rng, REF, testDataset } from './test-dataset.fake';
import { testCtx } from './test-context.fake';
import type { CapabilityContext } from './types';

/** Every value here is made up; the file name and hash are distinctive so a leak is findable. */
export const REPORT_FILENAME = 'private-report-name-7731.pdf';
export const REPORT_HASH = 'ab12'.repeat(16);

export function labReport(over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'results',
    documentDate: '2026-09-29',
    labName: 'Northside Clinical Lab',
    sourceFilename: REPORT_FILENAME,
    sourceSha256: REPORT_HASH,
    sourceBytes: 123456,
    pageCount: 2,
    extraction: { parserVersion: 'x' },
    notes: 'a private note',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    resultCount: 31,
    analyteCount: 28,
    dateCount: 1,
    firstResultOn: '2026-09-28',
    lastResultOn: '2026-09-28',
    ...over,
  };
}

export const REPORTS: ReportSummary[] = [
  labReport(),
  labReport({ id: '00000000-0000-4000-8000-000000000002', documentDate: '2026-03-12', labName: 'Lakeside Diagnostics', resultCount: 1, firstResultOn: '2026-03-10', lastResultOn: '2026-03-11' }),
];

/** A weight goal that started 60 days before REF. */
export const GOAL: BodyGoal = {
  id: 'goal-1',
  kind: 'weight',
  target: 78,
  paceKgPerWeek: null,
  startedOn: addDays(REF, -60),
  endedOn: null,
  status: 'active',
  revision: 1,
  updatedAt: '2026-08-09T10:00:00.000Z',
};

const obs = (day: string, qty: number, units: string, extra: Partial<MetricObservation> = {}): MetricObservation => ({ date: `${day}T15:00:00.000Z`, qty, units, source: 'test', ...extra });

/** The seeded dataset plus weigh-ins and a food log: complete days, a partial day, and gaps. */
export function bodyDataset(seed = 11): HealthFixtures {
  const base = testDataset(seed);
  const r = rng(seed + 100);
  const days = Array.from({ length: 90 }, (_, i) => addDays(REF, -(89 - i)));
  const metrics: HealthFixtures['metrics'] = { ...base.metrics };
  metrics.weight_body_mass = days.filter((_, i) => i % 2 === 0).map((d, i) => obs(d, 86 - i * 0.07 + r() * 0.2, 'kg'));
  metrics.body_fat_percentage = days.filter((_, i) => i % 7 === 0).map(d => obs(d, 24 + r(), '%'));
  const logged = days.slice(-45).filter((_, i) => i % 5 !== 4);
  metrics.dietary_energy = logged.map((d, i) => obs(d, d === addDays(REF, -3) ? 400 : 1900 + Math.round(r() * 500) + (i % 9 === 0 ? 700 : 0), 'kcal'));
  metrics.dietary_protein = logged.map(d => obs(d, 110 + Math.round(r() * 60), 'g'));
  metrics.dietary_carbs = logged.map(d => obs(d, 180 + Math.round(r() * 80), 'g'));
  metrics.dietary_fat_total = logged.map(d => obs(d, 60 + Math.round(r() * 30), 'g'));
  return { ...base, metrics };
}

export function installBodyDataset(seed = 11): HealthFixtures {
  const data = bodyDataset(seed);
  setActiveDataset(data, { mode: 'demo' });
  return data;
}

/** Readers that all work: the lab documents above, the goal over the installed dataset. */
export function healthyReaders(over: Partial<AppReaders> = {}): Partial<AppReaders> {
  return {
    databaseConfigured: () => true,
    labReports: async () => REPORTS,
    goalReport: async system => goalReportFromDataset(GOAL, system, null),
    goalSummary: async system => bodyGoalSummary(goalReportFromDataset(GOAL, system, null), system),
    ...over,
  };
}

/** A capability context whose app readers are these. */
export function appCtx(readers: Partial<AppReaders> = healthyReaders(), over: Partial<CapabilityContext> = {}): CapabilityContext {
  return testCtx({ app: readers, ...over });
}
