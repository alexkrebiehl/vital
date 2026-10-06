import { describe, expect, it } from 'vitest';
import type { ProvenanceRow } from '@/lib/adapters/normalize';
import type { AnalystResponse } from '@/lib/analyst/types';
import { loadTurnSources, sourceIdsForTurn, type TurnSources } from '@/lib/sources/tagging';
import type { SourceContext } from '@/lib/sources/registry';

function row(metricId: string, sources: string[], observations = 10): ProvenanceRow {
  return {
    metricId,
    haeMetric: metricId,
    aggregation: 'mean',
    canonicalUnit: '',
    sources,
    observations,
    recordsRead: observations,
    recordsKept: observations,
    firstDay: '2026-09-01',
    lastDay: '2026-09-17',
    unitConversions: [],
    dedupeRule: '',
  };
}

function turn(opts: {
  handlerId?: string;
  metrics?: string[];
  tools?: string[];
  note?: string;
  status?: AnalystResponse['status'];
}): Pick<AnalystResponse, 'handlerId' | 'status' | 'retrieval' | 'toolsUsed' | 'answer'> {
  return {
    handlerId: opts.handlerId ?? 'general',
    status: opts.status ?? 'ok',
    retrieval: {
      recordsRead: 0,
      note: opts.note ?? 'Selected context.',
      metrics: (opts.metrics ?? []).map(metricId => ({ metricId, window: 'Last 30 days', observations: 10 })),
    },
    toolsUsed: opts.tools,
    answer: null,
  };
}

const PROVENANCE: ProvenanceRow[] = [
  row('hrv_rmssd_sleep', ['Oura Ring']),
  row('resting_heart_rate', ["Sample's Apple Watch"]),
  row('sleep_analysis', ['Oura Ring', "Sample's Apple Watch"]),
  row('step_count', ["Sample's Apple Watch"]),
];

const BOTH: TurnSources = {
  provenance: PROVENANCE,
  activeIds: ['hae', 'lab', 'oura'],
  activeHealthIds: ['hae', 'oura'],
};

describe('sourceIdsForTurn', () => {
  it('tags a turn that used only a ring-only metric with oura', () => {
    const ids = sourceIdsForTurn(turn({ handlerId: 'hrv-trend', metrics: ['hrv_rmssd_sleep'] }), BOTH);
    expect(ids).toEqual(['oura']);
  });

  it('tags a turn that used only watch metrics with hae', () => {
    const ids = sourceIdsForTurn(turn({ handlerId: 'steps-vs-baseline', metrics: ['step_count'] }), BOTH);
    expect(ids).toEqual(['hae']);
  });

  it('tags a mixed turn with both', () => {
    const ids = sourceIdsForTurn(
      turn({ handlerId: 'sleep-vs-recovery', metrics: ['hrv_rmssd_sleep', 'resting_heart_rate'] }),
      BOTH
    );
    expect(ids).toEqual(['hae', 'oura']);
  });

  it('tags a metric both sources fed with both', () => {
    expect(sourceIdsForTurn(turn({ metrics: ['sleep_analysis'] }), BOTH)).toEqual(['hae', 'oura']);
  });

  it('ignores a provenance row that kept no observation', () => {
    const only = { ...BOTH, provenance: [row('sleep_analysis', ['Oura Ring'], 0), row('sleep_analysis', ["Sample's Apple Watch"])] };
    expect(sourceIdsForTurn(turn({ metrics: ['sleep_analysis'] }), only)).toEqual(['hae']);
  });

  it('adds lab for the lab handler, and for a lab block or lab tool', () => {
    expect(sourceIdsForTurn(turn({ handlerId: 'lab-results' }), BOTH)).toEqual(['lab']);
    expect(
      sourceIdsForTurn(turn({ metrics: ['step_count'], note: 'x Lab results: 3 series; 2 documents read.' }), BOTH)
    ).toEqual(['hae', 'lab']);
    expect(
      sourceIdsForTurn(turn({ metrics: ['step_count'], tools: ['compare_lab_panels'] }), BOTH)
    ).toEqual(['hae', 'lab']);
  });

  it('does not add lab when the note says lab results were not in the context', () => {
    const note = 'x Lab results are not in this context: no report.';
    expect(sourceIdsForTurn(turn({ metrics: ['step_count'], note }), BOTH)).toEqual(['hae']);
  });

  it('adds hae for medication records, which come from the HAE server', () => {
    const note = 'x Medication records: 3 logged — a (2 days).';
    expect(sourceIdsForTurn(turn({ metrics: ['hrv_rmssd_sleep'], note }), BOTH)).toEqual(['hae', 'oura']);
    expect(sourceIdsForTurn(turn({ metrics: ['hrv_rmssd_sleep'], tools: ['get_medications'] }), BOTH)).toEqual([
      'hae',
      'oura',
    ]);
  });

  it('uses every active health source for workouts', () => {
    expect(sourceIdsForTurn(turn({ handlerId: 'workout-frequency' }), BOTH)).toEqual(['hae', 'oura']);
    expect(sourceIdsForTurn(turn({ tools: ['get_workouts'], metrics: ['step_count'] }), BOTH)).toEqual(['hae', 'oura']);
  });

  it('falls back to every active source when the set cannot be determined', () => {
    // A tool whose metric is not known.
    expect(sourceIdsForTurn(turn({ tools: ['get_metrics'] }), BOTH)).toEqual(['hae', 'lab', 'oura']);
    // A metric with no provenance row.
    expect(sourceIdsForTurn(turn({ metrics: ['unlisted_metric'] }), BOTH)).toEqual(['hae', 'lab', 'oura']);
    // Nothing is known about the turn at all.
    expect(sourceIdsForTurn(turn({ status: 'unsupported' }), BOTH)).toEqual(['hae', 'lab', 'oura']);
  });

  it('treats a data tool as opaque even when a metric was listed', () => {
    // Under-tagging would leak; over-tagging only deletes more.
    expect(sourceIdsForTurn(turn({ metrics: ['step_count'], tools: ['get_metrics'] }), BOTH)).toEqual([
      'hae',
      'lab',
      'oura',
    ]);
  });

  it('never lets a name from HAE-relayed ring data count as the Oura source', () => {
    const relayed = { ...BOTH, provenance: [row('sleep_analysis', ['Oura'])] };
    expect(sourceIdsForTurn(turn({ metrics: ['sleep_analysis'] }), relayed)).toEqual(['hae']);
  });

  it('returns sorted, distinct ids', () => {
    const ids = sourceIdsForTurn(turn({ metrics: ['sleep_analysis', 'hrv_rmssd_sleep', 'resting_heart_rate'] }), BOTH);
    expect(ids).toEqual([...new Set(ids)].sort());
  });
});

describe('loadTurnSources', () => {
  const ctx = (labs: number, oura: boolean): SourceContext => ({
    env: {
      OURA_CLIENT_ID: 'c',
      OURA_CLIENT_SECRET: 's',
      OURA_REDIRECT_URI: 'http://localhost/cb',
      VITAL_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
    } as unknown as NodeJS.ProcessEnv,
    hasCredential: async id => id === 'hae' || (oura && id === 'oura'),
    labReportCount: async () => labs,
  });

  it('reads the active sets from the registry', async () => {
    expect(await loadTurnSources(PROVENANCE, ctx(2, true))).toEqual({
      provenance: PROVENANCE,
      activeIds: ['hae', 'lab', 'oura'],
      activeHealthIds: ['hae', 'oura'],
    });
  });

  it('tags with every known source when the registry cannot be read', async () => {
    const broken: SourceContext = {
      ...ctx(0, false),
      labReportCount: async () => {
        throw new Error('connection refused');
      },
    };
    const sources = await loadTurnSources([], broken);
    expect(sources.activeIds).toEqual(['hae', 'hevy', 'lab', 'oura']);
    expect(sources.activeHealthIds).toEqual(['hae', 'oura']);
  });
});
