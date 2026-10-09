// ── On-demand context, end to end ───────────────────────
//
// The service with a model that really calls the data tools: what it is sent in place
// of the data (an index, no values), what each tool call costs, that the answer is
// audited against what was fetched, that evidence may cite only what was fetched, and
// that a server which refuses tools still gets the whole question answered from the
// fixed context. Also the size budget on that fixed context.

import { COVERAGE_INDEX_MAX_CHARS } from './capabilities/coverage-index';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { askAnalyst, streamAnalyst, type AnalystStreamChunk } from './service';
import { fitToBudget } from './budget';
import { retrieveGeneral } from './retrieval';
import { buildContextPayload } from './systemPrompt';
import { readAnalystConfig } from './config';
import { isDataTool } from './tools/names';
import type { LabSeriesInput, LabSourceInput } from './labSnapshot';
import type { LabContextSnapshot, RetrievalBundle } from './types';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

type Reply = { status: number; json: unknown };
async function mockModel(reply: (n: number, body: Record<string, any>) => Reply) {
  const bodies: Record<string, any>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      bodies.push(body);
      const out = reply(bodies.length - 1, body);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

const toolCall = (id: string, name: string, args: unknown): Reply => ({
  status: 200,
  json: { model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
});
const said = (content: string): Reply => ({ status: 200, json: { model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] } });

const env = (url: string, extra: Record<string, string> = {}) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: '***', ANALYST_CONTEXT: 'ondemand', VITAL_DATA_MODE: 'demo', ...extra }) as unknown as NodeJS.ProcessEnv;

function obs(on: string, value: number) {
  return {
    on, value, valueText: null, unit: 'mg/dL', printedRefText: '<200 mg/dL',
    interval: { low: null, high: 200, origin: 'report' as const, refText: '<200 mg/dL', refBasis: null, bandNote: null, band: null },
    status: value > 200 ? ('out_high' as const) : ('in_range' as const), statusLabel: value > 200 ? 'High' : 'In range', tone: value > 200 ? ('attention' as const) : ('good' as const),
  };
}
const lab = (key: string, name: string, cat: string, pts: ReturnType<typeof obs>[]): LabSeriesInput => ({ seriesKey: key, analyteKey: key, displayName: name, category: cat, specimen: 'other', registered: false, unit: 'mg/dL', points: pts });
const SOURCE: LabSourceInput = {
  available: true, reason: null, documents: 2, totalObservations: 5, collisions: 0,
  series: [
    lab('total_cholesterol', 'Total cholesterol', 'Lipids', [obs('2026-09-29', 166), obs('2026-10-01', 231)]),
    lab('ldl', 'LDL cholesterol', 'Lipids', [obs('2026-09-29', 90), obs('2026-10-01', 95)]),
    lab('alt', 'ALT', 'Liver', [obs('2026-10-01', 41)]),
  ],
};
const noMeds = async () => null;

const ANSWER = (analysis: string, evidence: unknown[] = []) =>
  JSON.stringify({ title: 'Cholesterol rose', analysis, recommendations: [], summary: [], uncertainty: [], evidence, followUps: [] });

describe('on-demand mode', () => {
  it('sends an index and the tools, not the data', async () => {
    const model = await mockModel(() => said(ANSWER('Nothing to fetch.')));
    const r = await askAnalyst({ query: 'What do my labs show?' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.status).toBe('ok');
    const first = model.bodies[0];
    const user = first.messages.at(-1).content as string;
    expect(user).toContain('INDEX');
    expect(user).toContain('Panel dates (date: series measured): 2026-09-29: 2, 2026-10-01: 3');
    expect(user).toContain('Lipids: LDL cholesterol (2×), Total cholesterol (2×)');
    expect(user).not.toMatch(/231|"series":\[/);
    expect(user.length).toBeLessThan(20_000);
    const names = (first.tools as { function: { name: string } }[]).map(t => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['get_lab_results', 'compare_lab_panels', 'get_metrics', 'get_medications', 'get_routine_progress']));
    expect(first.messages[0].content).toContain('YOUR DATA IS FETCHED, NOT HANDED TO YOU');
  });

  it('fetches what the question needs, answers from it, and is audited against it', async () => {
    const model = await mockModel(n =>
      n === 0
        ? toolCall('c1', 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' })
        : said(ANSWER('Total cholesterol went from 166 mg/dL to 231 mg/dL between the two panels.', [{ metricId: 'total_cholesterol' }]))
    );
    const r = await askAnalyst({ query: 'Compare my Sept 29 and Oct 1 results' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.status).toBe('ok');
    expect(r.toolsUsed).toEqual(['compare_lab_panels']);
    expect(model.bodies).toHaveLength(2);

    const toolMsg = model.bodies[1].messages.at(-1);
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toContain('231');
    expect(toolMsg.content).not.toContain('Hemoglobin');

    // The figures it quoted came from the tool result, so they are grounded.
    expect(r.grounding?.unmatched).toEqual([]);
    // And the series it fetched can be cited, with a link of ours.
    expect(r.answer?.evidence.map(e => [e.metricId, e.href])).toEqual([['total_cholesterol', '/lab/total_cholesterol']]);
  });

  it('flags a figure the model made up', async () => {
    const model = await mockModel(n =>
      n === 0 ? toolCall('c1', 'get_lab_results', { analytes: ['ldl'] }) : said(ANSWER('LDL was 187 mg/dL.'))
    );
    const r = await askAnalyst({ query: 'How is my LDL?' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.grounding?.unmatched).toContain('187');
  });

  it('refuses evidence for a series it never fetched', async () => {
    const model = await mockModel(n =>
      n === 0 ? toolCall('c1', 'get_lab_results', { analytes: ['ldl'] }) : said(ANSWER('LDL is fine.', [{ metricId: 'ldl' }, { metricId: 'alt' }, { metricId: 'resting_heart_rate' }]))
    );
    const r = await askAnalyst({ query: 'How is my LDL?' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.answer?.evidence.map(e => e.metricId)).toEqual(['ldl']);
  });

  it('reports a lookup that failed back to the model so it can correct the call', async () => {
    const model = await mockModel(n =>
      n === 0
        ? toolCall('c1', 'compare_lab_panels', { dateA: '2026-09-28', dateB: '2026-10-01' })
        : n === 1
          ? toolCall('c2', 'compare_lab_panels', { dateA: '2026-09-29', dateB: '2026-10-01' })
          : said(ANSWER('Done.'))
    );
    const r = await askAnalyst({ query: 'Compare' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.status).toBe('ok');
    const afterBad = model.bodies[1].messages.at(-1);
    expect(afterBad.content).toContain('No lab results are dated 2026-09-28');
    expect(afterBad.content).toContain('panelDates');
    expect(r.toolsUsed).toEqual(['compare_lab_panels', 'compare_lab_panels']);
  });

  it('carries the earlier turns, so a follow-up needs no new fetch', async () => {
    const model = await mockModel(() => said(ANSWER('Same answer.')));
    await askAnalyst(
      { query: 'and why did that happen?', history: [{ role: 'user', content: 'How did cholesterol change?' }, { role: 'assistant', content: 'It rose after the second panel.' }] },
      { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds }
    );
    const user = model.bodies[0].messages.at(-1).content as string;
    expect(user).toContain('It rose after the second panel.');
    expect(user).toContain('avoid fetching what you already have');
  });

  it('says in the answer what it fetched', async () => {
    const model = await mockModel(n => (n === 0 ? toolCall('c1', 'get_lab_results', { analytes: ['alt'] }) : said(ANSWER('ALT is in range.'))));
    const r = await askAnalyst({ query: 'ALT?' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.retrieval.note).toContain('Fetched on demand: 1 lab series (ALT)');
  });

  it('never calls the loaders for data the model did not ask for', async () => {
    let meds = 0;
    const model = await mockModel(() => said(ANSWER('No fetch.')));
    await askAnalyst({ query: 'Hello' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: async () => (meds++, null) });
    expect(meds).toBe(0);
  });
});

describe('when tools are refused or off', () => {
  it('falls back to the full fixed context, and says so', async () => {
    const model = await mockModel(n => (n < 2 ? { status: 400, json: { error: { message: 'tools are not supported by this model' } } } : said(ANSWER('From the fixed context.'))));
    const r = await askAnalyst({ query: 'What do my labs show?' }, { env: env(model.url), labLoader: async () => ({ available: true, reason: null, documents: 2, totalObservations: 5, totalSeries: 1, collisions: 0, selection: 'overview', requestedAnalyte: null, requestedName: null, found: true, shownSeries: 0, capped: false, note: 'n', notIncludedSeries: [], series: [] }) as LabContextSnapshot, labSource: async () => SOURCE, medicationLoader: noMeds });
    expect(r.status).toBe('ok');
    expect(r.toolsUnavailable).toMatch(/unavailable/);
    const last = model.bodies.at(-1)!;
    expect(last.tools).toBeUndefined();
    const user = last.messages.at(-1).content as string;
    expect(user).toContain('"context"');
    // The selection is sent, labelled as incomplete and without tools; the coverage index still comes first.
    expect(user).toContain('STARTING SELECTION');
    expect(user).toContain('You cannot fetch more in this answer.');
    expect(user.indexOf('COVERAGE')).toBeLessThan(user.indexOf('"context"'));
    expect(user).not.toContain('Fetch the data this question needs');
  });

  it('streams through the same fallback', async () => {
    const model = await mockModel(n => (n < 2 ? { status: 400, json: { error: { message: 'tools are not supported' } } } : said(ANSWER('Streamed fallback.'))));
    const { chunks } = streamAnalyst({ query: 'What do my labs show?' }, { env: env(model.url), labSource: async () => SOURCE, medicationLoader: noMeds });
    const out: AnalystStreamChunk[] = [];
    for await (const c of chunks) out.push(c);
    const last = out.at(-1)!;
    expect(last.kind).toBe('result');
    if (last.kind === 'result') expect(last.response.toolsUnavailable).toMatch(/unavailable/);
  });

  it('ANALYST_TOOLS=off keeps the full context even when ondemand is asked for', async () => {
    const model = await mockModel(() => said(ANSWER('Fixed.')));
    await askAnalyst({ query: 'How is my sleep?' }, { env: env(model.url, { ANALYST_TOOLS: 'off' }), medicationLoader: noMeds, labLoader: async () => null });
    const user = model.bodies[0].messages.at(-1).content as string;
    expect(user).toContain('"context"');
    expect(model.bodies[0].tools).toBeUndefined();
  });

  it('the default is the full context', () => {
    expect(readAnalystConfig({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'http://x/v1', ANALYST_MODEL: 'm' } as unknown as NodeJS.ProcessEnv).context).toBe('full');
    expect(readAnalystConfig({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'http://x/v1', ANALYST_MODEL: 'm', ANALYST_CONTEXT: 'ONDEMAND' } as unknown as NodeJS.ProcessEnv).context).toBe('ondemand');
    expect(readAnalystConfig({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'http://x/v1', ANALYST_MODEL: 'm', ANALYST_CONTEXT: 'nonsense' } as unknown as NodeJS.ProcessEnv).context).toBe('full');
  });
});

describe('the size budget on the fixed context', () => {
  /** A general bundle with a large lab block attached, like the owner's. */
  function heavy(): RetrievalBundle {
    const base = retrieveGeneral('2026-09-17');
    const series = Array.from({ length: 80 }, (_, i) => {
      const input = lab(`s${String(i).padStart(2, '0')}`, `Analyte ${String(i).padStart(2, '0')}`, `Cat ${i % 8}`, [obs('2026-09-29', i), obs('2026-10-01', i + 1)]);
      return {
        seriesKey: input.seriesKey, displayName: input.displayName, specimen: input.specimen, registered: false, unit: 'mg/dL', observations: 2, shownPoints: 2, truncated: false,
        latest: { ...obs('2026-10-01', i + 1), intervalText: '<200', intervalBasis: 'printed on the report', interval: obs('x', 1).interval },
        previous: { ...obs('2026-09-29', i), intervalText: '<200', intervalBasis: 'printed on the report', interval: obs('x', 1).interval },
        history: [],
        display: { name: input.displayName, latest: `${i + 1} mg/dL`, line: 'x'.repeat(300) },
      };
    });
    return {
      ...base,
      lab: { available: true, reason: null, documents: 2, totalObservations: 160, totalSeries: 80, collisions: 0, selection: 'overview', requestedAnalyte: null, requestedName: null, found: true, shownSeries: 80, capped: false, note: 'showing all 80 lab series', notIncludedSeries: [], series: series as unknown as LabContextSnapshot['series'] },
    };
  }
  const size = (b: RetrievalBundle) => JSON.stringify(buildContextPayload(b, 'metric')).length;

  it('leaves a context that already fits exactly as it was', () => {
    const b = heavy();
    const r = fitToBudget(b, 'metric', size(b) + 1000, 'How is my sleep?');
    expect(r.bundle).toBe(b);
    expect(r.dropped).toEqual([]);
  });

  it('brings an oversized context under the limit and names what it removed', () => {
    const b = heavy();
    const limit = Math.floor(size(b) * 0.6);
    const r = fitToBudget(b, 'metric', limit, 'How is my sleep?');
    expect(r.chars).toBeLessThanOrEqual(limit + 600);
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(r.bundle.note).toContain('NOT SENT, to fit the size limit');
    expect(r.bundle.note).toContain('do not say it is not recorded');
  });

  it('keeps the labs and drops the metrics when the question is about labs', () => {
    const b = heavy();
    // Just above the size without the metrics: dropping them is enough, so no lab series may go.
    const withoutMetrics = size({ ...b, summaries: [], pairs: [], workouts: null });
    expect(size(b)).toBeGreaterThan(withoutMetrics + 2000);
    const r = fitToBudget(b, 'metric', withoutMetrics + 500, 'What do my lab results show?');
    expect(r.bundle.lab?.series.length).toBe(80);
    expect(r.dropped.join(' ')).toMatch(/metric/);
    expect(r.dropped.join(' ')).not.toMatch(/lab series/);
  });

  it('trims the labs first when the question is about something else', () => {
    const b = heavy();
    const r = fitToBudget(b, 'metric', Math.floor(size(b) * 0.55), 'How is my sleep?');
    expect(r.bundle.lab!.series.length).toBeLessThan(80);
    expect(r.bundle.lab!.capped).toBe(true);
    expect(r.bundle.lab!.notIncludedSeries.length).toBe(80 - r.bundle.lab!.series.length);
    expect(r.bundle.summaries.length).toBeGreaterThan(0);
  });

  it('applies to the fixed context the service sends', async () => {
    const model = await mockModel(() => said(ANSWER('ok')));
    const big: LabContextSnapshot = heavy().lab as LabContextSnapshot;
    await askAnalyst({ query: 'How is my sleep?' }, { env: env(model.url, { ANALYST_CONTEXT: 'full', ANALYST_CONTEXT_MAX_CHARS: '12000' }), labLoader: async () => big, medicationLoader: noMeds });
    const user = model.bodies[0].messages.at(-1).content as string;
    expect(user).toContain('NOT SENT, to fit the size limit');
    // The fixed context honours its budget; the coverage index in front of it has its own bound.
    expect(user.length).toBeLessThan(40_000 + COVERAGE_INDEX_MAX_CHARS);
  });
});

describe('what a question is about', () => {
  it('reads lab words and analyte names as lab questions, and a wearable question as not', async () => {
    const { isLabQuestion } = await import('./questionKind');
    for (const q of ['What do my lab results show?', 'Review my blood work', 'Compare my panel from Sept 29', 'How is my LDL?', 'is my hemoglobin low']) {
      expect(isLabQuestion(q), q).toBe(true);
    }
    for (const q of ['How is my sleep?', 'Did my resting heart rate rise?', 'How much protein am I eating?']) {
      expect(isLabQuestion(q), q).toBe(false);
    }
  });
});

describe('tool names', () => {
  it('knows which tools fetch data', () => {
    expect(isDataTool('get_lab_results')).toBe(true);
    expect(isDataTool('set_path_hold')).toBe(false);
  });
});
