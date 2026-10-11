// ── app.pipeline (SERVER ONLY) ───────────────────────────────────────────────
//
// The Settings panel's status, cut to what the model may know (design §9.1): per
// source its kind, display name, whether it is connected, when it last delivered and
// how much; per stage whether it is ok and a fixed reason. This is the one capability
// that names a source. The report itself carries hosts, URLs, probe bodies and raw
// error text; none of it is copied, and no reason is the source's own words.

import type { PipelineStage, PipelineStatusReport, ProbeOutcome } from '../../../pipeline/types';
import { DATA_SOURCES, type DataSourceDef } from '../../../sources/registry';
import { manifestEntry } from '../manifest';
import { ok } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, type Args, type Read } from './common';
import { clean } from './app-common';
import { countOf } from './app-format';
import { readersOf } from './app-readers';

const PROBE: Record<ProbeOutcome, string> = {
  ok: 'Checked and healthy.',
  http_error: 'The source answered with an error.',
  network_error: 'The source could not be reached.',
  timeout: 'The source did not answer in time.',
  invalid_payload: 'The source answered with data the app could not read.',
  not_configured: 'Not connected.',
};

function reasonOf(s: PipelineStage, report: PipelineStatusReport): string {
  if (s.status === 'healthy') return 'Checked and healthy.';
  if (s.status === 'unconfigured') return 'Not connected.';
  if (s.status === 'unknown') return 'Not checked yet.';
  switch (s.id) {
    case 'health_auto_export':
    case 'health_api':
      return PROBE[report.probe.outcome] ?? 'The last check failed.';
    case 'data_quality':
      return 'The data-quality checks found problems to fix.';
    case 'intelligence':
      return report.dataset.error ? 'The data could not be read.' : 'No observations were found.';
    default:
      return 'The last check of this source failed.';
  }
}

const dayOf = (iso: string | null | undefined): string | undefined => (iso ? iso.slice(0, 10) : undefined);
const sourceDef = (id: string): DataSourceDef | undefined => DATA_SOURCES.find(d => d.id === id);

/** A health source and its stage: the report names the stage after the source's display name. */
function healthSource(def: DataSourceDef, report: PipelineStatusReport) {
  const stage = report.stages.find(s => s.name === def.displayName);
  if (!stage) return null;
  const connected = stage.status !== 'unconfigured';
  const records = connected && stage.observationCount ? stage.observationCount : null;
  return clean({
    name: def.displayName,
    kind: def.kind,
    connected,
    lastRead: connected ? dayOf(stage.lastObservationAt) : undefined,
    records: records ?? undefined,
    display: records ? { records: countOf(records, 'observation') } : undefined,
  });
}

function workoutSources(report: PipelineStatusReport) {
  return report.workoutSources.map(s =>
    clean({
      name: s.displayName,
      kind: 'workout detail',
      connected: s.configured,
      lastRead: s.configured ? dayOf(s.lastSyncAt) : undefined,
      records: s.configured && s.sessions > 0 ? s.sessions : undefined,
      display: s.configured && s.sessions > 0 ? { records: countOf(s.sessions, 'session') } : undefined,
    })
  );
}

async function labSource(ctx: CapabilityContext) {
  const def = sourceDef('lab');
  try {
    const reports = await readersOf(ctx).labReports(ctx.env);
    if (!def || reports === null) return [];
    const results = reports.reduce((n, r) => n + r.resultCount, 0);
    const last = reports.map(r => r.documentDate ?? r.lastResultOn).filter((d): d is string => d !== null).sort().pop();
    return [clean({ name: def.displayName, kind: def.kind, connected: reports.length > 0, lastRead: last, records: results, display: { records: `${countOf(results, 'result')} in ${countOf(reports.length, 'document')}` } })];
  } catch {
    // A store that cannot be read leaves the lab line out; the other sources are still true.
    return [];
  }
}

export function readPipeline(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.pipeline');
  return guarded(entry, ctx, async () => {
    const report = await readersOf(ctx).pipeline(ctx.env);
    const health = DATA_SOURCES.filter(def => def.kind === 'health').map(def => healthSource(def, report));
    const sources = [...health, ...workoutSources(report), ...(await labSource(ctx))].filter(s => s !== null);
    return ok(entry, {
      mode: report.mode,
      dataAsOf: dayOf(report.dataAsOf),
      sources,
      stages: report.stages.map(s => ({ name: s.name, ok: s.status === 'healthy', reason: reasonOf(s, report) })),
    });
  });
}
