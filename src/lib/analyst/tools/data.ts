// ── Analyst tools: the health data, on demand (SERVER ONLY) ──
//
// Read-only tools a model calls to fetch exactly the data a question needs, instead
// of being handed all of it with every question. Each one reuses the reader the fixed
// context is built from, so a figure fetched here is the same figure — formatted by
// the same registry formatter, scored by the same lab status engine — that the fixed
// context would have carried.
//
// BOUNDED, AND IT SAYS SO. Every result stays under MAX_DATA_RESULT_CHARS. When a
// request would be bigger, the tool narrows it in a stated way (series left out,
// rows capped) or refuses with the limit and how to ask for less — a result is never
// cut off mid-JSON. Whatever a tool returns is recorded in ctx.data.fetched, which is
// what lets the answer cite it and the number audit check it.

import { isPairedMetric, metricHasData, seriesFor, unavailableReasonFor } from '../../adapters/dataset';
import { getMetric } from '../../metrics/registry';
import { scrubForModel } from '../scrub';
import { PAIRED_REASON, resolveMetric } from './metric-resolve';
import { getMetricSeries } from './series-tool';
import { getBloodPressure, getSleep, getWorkouts } from './records-tools';
import { getMedications } from './medications-tool';
import { getAppData } from './app-data-tool';
import { listCapabilities } from './list-capabilities';
import { formatDeltaWithUnit, formatMetricWithUnit, metricUnit } from '../../metrics/format';
import { formatPercent } from '../../metrics/format';
import { containsDay, makeWindow } from '../../analytics/windows';
import { resolveWindow, WINDOW_SCHEMA } from '../capabilities/window';
import { labInWindow, namesNotInWindow } from '../capabilities/reads/lab-window';
import { mean, median, max as maxOf, min as minOf, percentChange } from '../../analytics/stats';
import { analyteRequestedBy, changeText, readingText, seriesSnapshot, toReading, type LabSeriesInput } from '../labSnapshot';
import { MAX_POINTS_PER_SERIES, pairFor, summaryFor } from '../retrieval';
import { summaryPayload } from '../systemPrompt';
import type { RetrievedSummary } from '../types';
import type { DataAccess } from '../dataAccess';
import type { AnalystTool, ToolContext, ToolOutcome } from './index';

/** A data tool's result, in characters of JSON. Under the loop's own 14,000 cut-off, so nothing is ever sliced. */
export const MAX_DATA_RESULT_CHARS = 12_000;
export const MAX_METRICS_PER_CALL = 3;
export const MAX_LAB_SERIES_PER_CALL = 20;
export const MAX_COMPARE_ROWS = 60;
export const MAX_WINDOW_DAYS = 730;

const size = (value: unknown): number => JSON.stringify(value).length;

function need(ctx: ToolContext): DataAccess | ToolOutcome {
  return (
    ctx.data ?? {
      isError: true,
      content: { error: 'Health data is not available through tools for this question; use the context provided.' },
    }
  );
}
const isOutcome = (x: DataAccess | ToolOutcome): x is ToolOutcome => 'content' in x;

const fail = (error: string, extra: Record<string, unknown> = {}): ToolOutcome => ({ isError: true, content: { error, ...extra } });

// ── Metric summaries ────────────────────────────────────

function note(access: DataAccess, line: string): void {
  access.fetched.log.push(line);
}

function remember(access: DataAccess, s: RetrievedSummary, keepPoints: boolean): void {
  const stored = keepPoints ? s : { ...s, points: [] };
  const i = access.fetched.summaries.findIndex(
    x => x.metricId === s.metricId && x.window.startKey === s.window.startKey && x.window.endKey === s.window.endKey
  );
  if (i >= 0) access.fetched.summaries[i] = stored;
  else access.fetched.summaries.push(stored);
  access.fetched.recordsRead += s.points.length;
}

const getMetrics: AnalystTool = {
  name: 'get_metrics',
  kind: 'read',
  description:
    `Up to ${MAX_METRICS_PER_CALL} metrics over the last N days against the N before, with a daily series. Quote the "display" strings. get_metric_series does more.`,
  parameters: {
    type: 'object',
    required: ['metrics'],
    properties: {
      metrics: { type: 'array', items: { type: 'string' }, maxItems: MAX_METRICS_PER_CALL, description: 'Metric ids from the index, e.g. "resting_heart_rate".' },
      days: { type: 'integer', minimum: 1, maximum: MAX_WINDOW_DAYS, description: 'Length of the window in days, ending on the latest day with data. Default 30.' },
      series: { type: 'boolean', description: 'Include the daily series (at most 90 points). Default true.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const access = need(ctx);
    if (isOutcome(access)) return access;
    const days = typeof args.days === 'number' ? Math.round(args.days) : 30;
    const wantSeries = args.series !== false;
    const ids: string[] = [];
    const problems: { metric: string; problem: string; didYouMean?: string[] }[] = [];
    for (const name of args.metrics as string[]) {
      const r = resolveMetric(name);
      if ('error' in r) problems.push({ metric: name, problem: r.error, didYouMean: r.didYouMean });
      else if (!ids.includes(r.id)) ids.push(r.id);
    }

    const out: { id: string; payload: ReturnType<typeof summaryPayload>; summary: RetrievedSummary }[] = [];
    const empty: { metric: string; reason: string }[] = [];
    for (const id of ids) {
      if (isPairedMetric(id)) {
        empty.push({ metric: id, reason: PAIRED_REASON });
        continue;
      }
      if (!metricHasData(id)) {
        empty.push({ metric: id, reason: unavailableReasonFor(id) });
        continue;
      }
      const built = summaryFor(id, days, access.refKey);
      out.push({ id, payload: summaryPayload(built.summary, access.system), summary: built.summary });
    }

    // Keep the whole result under the limit: drop daily series (latest-listed first), and say so.
    const seriesOmitted: string[] = [];
    const render = () =>
      out.map(o => ({ ...o.payload, series: seriesOmitted.includes(o.id) || !wantSeries ? undefined : o.payload.series }));
    if (!wantSeries) seriesOmitted.push(...out.map(o => o.id));
    for (let i = out.length - 1; i >= 0 && size({ metrics: render() }) > MAX_DATA_RESULT_CHARS - 1500; i--) {
      if (!seriesOmitted.includes(out[i].id)) seriesOmitted.push(out[i].id);
    }
    if (size({ metrics: render() }) > MAX_DATA_RESULT_CHARS) {
      return fail(`The result is too large (${size({ metrics: render() })} characters, limit ${MAX_DATA_RESULT_CHARS}). Ask for fewer metrics or a shorter window.`);
    }
    for (const o of out) {
      remember(access, o.summary, !seriesOmitted.includes(o.id));
      note(access, `${o.summary.metricName}, last ${days} days`);
    }
    return {
      content: {
        unitSystem: access.system,
        metrics: render(),
        ...(seriesOmitted.length ? { seriesOmitted: { metrics: seriesOmitted, why: 'left out to keep the result within its size limit; ask for these metrics alone to get the series' } } : {}),
        ...(empty.length ? { noData: empty } : {}),
        ...(problems.length ? { notFound: problems } : {}),
      },
    };
  },
};

// ── Any two periods ─────────────────────────────────────

const compareMetricPeriods: AnalystTool = {
  name: 'compare_periods',
  kind: 'read',
  description:
    'One metric over two date ranges you name (YYYY-MM-DD): each one\'s summary and the change from A to B, as display strings.',
  parameters: {
    type: 'object',
    required: ['metric', 'aStart', 'aEnd', 'bStart', 'bEnd'],
    properties: {
      metric: { type: 'string', description: 'A metric id from the index.' },
      aStart: { type: 'string' },
      aEnd: { type: 'string' },
      bStart: { type: 'string' },
      bEnd: { type: 'string' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const access = need(ctx);
    if (isOutcome(access)) return access;
    const r = resolveMetric(String(args.metric));
    if ('error' in r) return fail(r.error, { didYouMean: r.didYouMean });
    const date = /^\d{4}-\d{2}-\d{2}$/;
    for (const k of ['aStart', 'aEnd', 'bStart', 'bEnd']) if (!date.test(String(args[k]))) return fail(`${k} must be a date as YYYY-MM-DD.`);
    const a = { startKey: String(args.aStart), endKey: String(args.aEnd), label: 'Period A' };
    const b = { startKey: String(args.bStart), endKey: String(args.bEnd), label: 'Period B' };
    if (a.startKey > a.endKey || b.startKey > b.endKey) return fail('A period must start on or before the day it ends.');
    if (isPairedMetric(r.id)) return fail(PAIRED_REASON);
    if (!metricHasData(r.id)) return fail(`No ${getMetric(r.id)?.displayName ?? r.id} data is recorded.`, { reason: unavailableReasonFor(r.id) });

    const meta = getMetric(r.id);
    const accumulating = meta?.aggregationStrategy === 'sum';
    const take = (w: typeof a) => {
      const pts = seriesFor(r.id).filter(p => containsDay(w, p.key));
      // A day still accumulating is not a day: it would drag a daily total down.
      const complete = accumulating ? pts.filter(p => p.partial !== true && p.key !== access.refKey) : pts;
      return { values: complete.map(p => p.value), dropped: pts.length - complete.length };
    };
    const A = take(a);
    const B = take(b);
    const show = (v: number[], f: (x: number[]) => number) => (v.length ? formatMetricWithUnit(r.id, f(v), access.system) : 'no records');
    const describe = (w: typeof a, t: ReturnType<typeof take>) => ({
      range: `${w.startKey} to ${w.endKey}`,
      observations: t.values.length,
      mean: show(t.values, mean),
      median: show(t.values, median),
      min: show(t.values, minOf),
      max: show(t.values, maxOf),
      ...(t.dropped ? { note: `${t.dropped} day(s) still accumulating were left out` } : {}),
    });
    let change: Record<string, string>;
    if (A.values.length && B.values.length) {
      const d = mean(B.values) - mean(A.values);
      const pct = percentChange(mean(B.values), mean(A.values));
      change = { meanChange: formatDeltaWithUnit(r.id, d, access.system), meanChangePercent: formatPercent(pct) };
    } else {
      change = { meanChange: 'no comparison available: a period has no records' };
    }
    access.fetched.citable.add(r.id);
    access.fetched.recordsRead += A.values.length + B.values.length;
    note(access, `${meta?.displayName ?? r.id}, ${a.startKey}..${a.endKey} vs ${b.startKey}..${b.endKey}`);
    return {
      content: {
        metric: r.id,
        metricName: meta?.displayName ?? r.id,
        unit: metricUnit(r.id, access.system) || 'count (no unit)',
        aggregation: accumulating ? 'daily total, complete days only' : meta?.aggregationStrategy === 'latest' ? 'latest recorded value' : 'daily average',
        periodA: describe(a, A),
        periodB: describe(b, B),
        ...change,
        note: 'Quote the display strings; B is compared against A.',
      },
    };
  },
};

/** The two group means of a relationship split, in each metric's own formatter. */
function groupDisplay(xId: string, yId: string, g: { xMean: number; yMean: number }, system: DataAccess['system']): Record<string, string> {
  return { xMean: formatMetricWithUnit(xId, g.xMean, system), yMean: formatMetricWithUnit(yId, g.yMean, system) };
}

const getRelationship: AnalystTool = {
  name: 'get_metric_relationship',
  kind: 'read',
  description:
    'How two metrics move together over the last N days: the correlation, how many days were paired, and the average of Y on days when X was below versus at-or-above its median. Same-day, or lagged (X today against Y some days later). A correlation is an association, never a cause.',
  parameters: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      x: { type: 'string' },
      y: { type: 'string' },
      window: { ...WINDOW_SCHEMA, description: `${WINDOW_SCHEMA.description} Default: the last 90 days.` },
      days: { type: 'integer', minimum: 7, maximum: MAX_WINDOW_DAYS, description: 'Same as window.lastDays. Default 90.' },
      lagDays: { type: 'integer', minimum: 1, maximum: 14, description: 'Pair X with Y this many days later. Omit for same-day.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const access = need(ctx);
    if (isOutcome(access)) return access;
    const x = resolveMetric(String(args.x));
    const y = resolveMetric(String(args.y));
    if ('error' in x) return fail(x.error, { didYouMean: x.didYouMean });
    if ('error' in y) return fail(y.error, { didYouMean: y.didYouMean });
    const lag = typeof args.lagDays === 'number' ? Math.round(args.lagDays) : 0;
    if (typeof args.days === 'number' && args.window !== undefined) return fail('Give either window or days (the same as window.lastDays), not both.');
    const w = resolveWindow(typeof args.days === 'number' ? { lastDays: Math.round(args.days) } : args.window, { refKey: access.refKey, defaultLastDays: 90 });
    if (!w.ok) return fail(w.problems.join(' '));
    const built = pairFor(
      { x: x.id, y: y.id, alignment: lag > 0 ? 'lagged' : 'same-day', lagDays: lag || undefined, window: makeWindow(w.window.start, w.window.end, `${w.window.asked}`), splitByX: true },
      access.refKey
    );
    const p = built.pair;
    access.fetched.pairs.push(p);
    access.fetched.citable.add(x.id);
    access.fetched.citable.add(y.id);
    access.fetched.recordsRead += built.recordsRead;
    note(access, `${x.id} vs ${y.id}`);
    return {
      content: {
        x: x.id,
        y: y.id,
        alignment: p.alignment,
        lagDays: p.lagDays,
        coefficient: p.coefficient,
        pairedDays: p.pairedCount,
        valid: p.valid,
        reason: p.reason,
        window: { start: p.window.startKey, end: p.window.endKey },
        split: p.split && {
          ...p.split,
          low: { ...p.split.low, display: groupDisplay(x.id, y.id, p.split.low, access.system) },
          high: { ...p.split.high, display: groupDisplay(x.id, y.id, p.split.high, access.system) },
          display: { medianX: formatMetricWithUnit(x.id, p.split.medianX, access.system) },
        },
        display: { lagDays: p.lagDays ? `${p.lagDays} days later` : 'same day' },
      },
    };
  },
};

// ── Labs ────────────────────────────────────────────────

/** Series the model asked for: by series key, analyte key, or a name (display name, alias, "vitamin d"). */
function matchSeries(all: LabSeriesInput[], names: string[]): { matched: LabSeriesInput[]; unmatched: string[] } {
  const matched: LabSeriesInput[] = [];
  const unmatched: string[] = [];
  const add = (s: LabSeriesInput) => {
    if (!matched.some(m => m.seriesKey === s.seriesKey)) matched.push(s);
  };
  for (const raw of names) {
    const name = raw.trim();
    const q = name.toLowerCase();
    let hits = all.filter(s => s.seriesKey.toLowerCase() === q || s.analyteKey.toLowerCase() === q);
    if (!hits.length) hits = all.filter(s => s.displayName.toLowerCase() === q);
    if (!hits.length) {
      const key = analyteRequestedBy(name)?.key;
      if (key) hits = all.filter(s => s.analyteKey === key);
    }
    if (!hits.length && q.length >= 3) hits = all.filter(s => s.displayName.toLowerCase().includes(q));
    if (hits.length) hits.forEach(add);
    else unmatched.push(name);
  }
  return { matched, unmatched };
}

const COMPACT_KEYS = ['name', 'specimen', 'observations', 'latest', 'latestOn', 'status', 'interval', 'intervalBasis', 'previous', 'previousOn', 'change', 'printedResult', 'expectedResult', 'history', 'historyTruncated'];

const getLabResults: AnalystTool = {
  name: 'get_lab_results',
  kind: 'read',
  description: `Stored lab results by name or category. Each series: latest value, unit, date, reference interval (as printed, or the fallback and which), status, previous observation and change; history=true adds earlier observations (at most ${MAX_POINTS_PER_SERIES}). Qualitative results come back as printed. Name analytes as in the index (a series key, or a name like "LDL"). At most ${MAX_LAB_SERIES_PER_CALL} series per call.`,
  parameters: {
    type: 'object',
    properties: {
      analytes: { type: 'array', items: { type: 'string' }, maxItems: 40, description: 'Series keys or analyte names.' },
      category: { type: 'string', description: 'A lab category from the index, for every series in it.' },
      flaggedOnly: { type: 'boolean', description: 'Only series whose latest result is outside its interval.' },
      history: { type: 'boolean', description: 'Include every earlier observation. Default false.' },
      window: { ...WINDOW_SCHEMA, description: 'Only results measured in it (latest, change and history too). Default: all.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const access = need(ctx);
    if (isOutcome(access)) return access;
    const src = await access.labSource();
    if (!src.available) return fail(scrubForModel(src.reason ?? 'No lab results are available.'));
    let all = src.series;
    let windowEcho: { start: string; end: string; asked: string; clipped?: string } | null = null;
    if (args.window !== undefined) {
      const w = resolveWindow(args.window, { refKey: access.refKey, defaultLastDays: 90 });
      if (!w.ok) return fail(w.problems.join(' '));
      windowEcho = w.window;
      all = labInWindow(src.series, w.window);
    }
    let pool = all;
    const names = Array.isArray(args.analytes) ? (args.analytes as string[]) : [];
    let unmatched: string[] = [];
    if (names.length) {
      const m = matchSeries(all, names);
      pool = m.matched;
      unmatched = m.unmatched;
    }
    if (typeof args.category === 'string' && args.category.trim()) {
      const c = args.category.trim().toLowerCase();
      const inCat = all.filter(s => s.category.toLowerCase() === c);
      if (!inCat.length) return fail(`No lab category "${args.category}".`, { categories: [...new Set(src.series.map(s => s.category))] });
      pool = names.length ? pool.filter(s => s.category.toLowerCase() === c) : inCat;
    }
    if (!names.length && !(typeof args.category === 'string' && args.category.trim()) && args.flaggedOnly !== true) {
      return fail('Say which results to fetch: analytes, a category, or flaggedOnly. The index lists every series.');
    }
    // A series with nothing measured in the window is named, never dropped.
    const emptyInWindow = windowEcho ? pool.filter(s => s.points.length === 0) : [];
    if (windowEcho) pool = pool.filter(s => s.points.length > 0);
    if (args.flaggedOnly === true) pool = pool.filter(s => s.points.length > 0 && s.points[s.points.length - 1]!.status !== 'in_range' && s.points[s.points.length - 1]!.status !== 'unscored_no_range');
    const history = args.history === true;
    const cut = pool.length > MAX_LAB_SERIES_PER_CALL;
    const shown = pool.slice(0, MAX_LAB_SERIES_PER_CALL);

    const entries = shown.map(s => {
      const snap = seriesSnapshot(s, history ? 'analyte' : 'overview', MAX_POINTS_PER_SERIES);
      return { snap, view: { seriesKey: s.seriesKey, category: s.category, ...Object.fromEntries(COMPACT_KEYS.filter(k => snap.display[k] !== undefined).map(k => [k, snap.display[k]])) } };
    });
    // Within the size limit: drop the history of the last series first, then the last series, and say so.
    const dropped: string[] = [];
    const view = () => entries.map(e => e.view);
    while (entries.length > 1 && size({ results: view() }) > MAX_DATA_RESULT_CHARS - 1200) {
      const e = entries.pop()!;
      dropped.push(e.snap.displayName);
    }
    if (size({ results: view() }) > MAX_DATA_RESULT_CHARS) return fail('That one series is too large to return; ask without history.');

    for (const e of entries) access.fetched.labSeries.set(e.snap.seriesKey, e.snap);
    access.fetched.recordsRead += entries.reduce((n, e) => n + e.snap.shownPoints, 0);
    if (entries.length) note(access, `${entries.length} lab series (${entries.slice(0, 4).map(e => e.snap.displayName).join(', ')}${entries.length > 4 ? ', …' : ''})`);
    const left = [...pool.slice(MAX_LAB_SERIES_PER_CALL).map(s => s.displayName), ...dropped];
    return {
      content: {
        results: view(),
        ...(windowEcho ? { window: windowEcho, ...(emptyInWindow.length ? { notInWindow: namesNotInWindow(emptyInWindow), notInWindowNote: 'Nothing was measured for these in the window; that says nothing about other dates.' } : {}) } : {}),
        ...(unmatched.length ? { notFound: unmatched, note: 'These names matched no stored series; check the index before saying a result does not exist.' } : {}),
        ...(left.length || cut ? { notReturned: left, why: 'over the per-call limit; ask for these in another call' } : {}),
      },
    };
  },
};

const compareLabPanels: AnalystTool = {
  name: 'compare_lab_panels',
  kind: 'read',
  description: `Compare every lab series measured on two dates (use the panel dates from the index): for each, the value on date A, the value on date B, the change, and the status on both. Series measured on only one of the dates are listed by name. Optionally limit to a category. At most ${MAX_COMPARE_ROWS} rows.`,
  parameters: {
    type: 'object',
    required: ['dateA', 'dateB'],
    properties: {
      dateA: { type: 'string', description: 'YYYY-MM-DD, an earlier panel date.' },
      dateB: { type: 'string', description: 'YYYY-MM-DD, a later panel date.' },
      category: { type: 'string' },
      changedOnly: { type: 'boolean', description: 'Only series whose value or status differs. Default false.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const access = need(ctx);
    if (isOutcome(access)) return access;
    const src = await access.labSource();
    if (!src.available) return fail(scrubForModel(src.reason ?? 'No lab results are available.'));
    const A = String(args.dateA);
    const B = String(args.dateB);
    const dates = new Map<string, number>();
    for (const s of src.series) for (const p of s.points) dates.set(p.on, (dates.get(p.on) ?? 0) + 1);
    const panel = [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([on, series]) => ({ on, series }));
    for (const d of [A, B]) if (!dates.has(d)) return fail(`No lab results are dated ${d}.`, { panelDates: panel });
    if (A === B) return fail('Pick two different dates.');

    const cat = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
    const rows: { seriesKey: string; name: string; category: string; a: string; b: string; change: string; status: string; changed: boolean; input: LabSeriesInput }[] = [];
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    for (const s of src.series) {
      if (cat && s.category.toLowerCase() !== cat) continue;
      const pa = s.points.find(p => p.on === A);
      const pb = s.points.find(p => p.on === B);
      if (pa && pb) {
        const ra = toReading(pa);
        const rb = toReading(pb);
        const same = pa.value === pb.value && pa.valueText === pb.valueText && pa.status === pb.status;
        rows.push({
          seriesKey: s.seriesKey,
          name: s.displayName,
          category: s.category,
          a: readingText(ra),
          b: readingText(rb),
          change: changeText(ra, rb),
          status: ra.statusLabel === rb.statusLabel ? rb.statusLabel : `${ra.statusLabel} → ${rb.statusLabel}`,
          changed: !same,
          input: s,
        });
      } else if (pa) onlyA.push(s.displayName);
      else if (pb) onlyB.push(s.displayName);
    }
    const wanted = args.changedOnly === true ? rows.filter(r => r.changed) : rows;
    wanted.sort((x, y) => Number(y.changed) - Number(x.changed) || x.name.localeCompare(y.name));
    let shown = wanted.slice(0, MAX_COMPARE_ROWS);
    const render = () => shown.map(r => ({ seriesKey: r.seriesKey, name: r.name, category: r.category, [A]: r.a, [B]: r.b, change: r.change, status: r.status }));
    while (shown.length > 1 && size({ rows: render() }) > MAX_DATA_RESULT_CHARS - 1500) shown = shown.slice(0, -1);
    for (const r of shown) access.fetched.labSeries.set(r.seriesKey, seriesSnapshot(r.input, 'overview', MAX_POINTS_PER_SERIES));
    access.fetched.recordsRead += shown.length * 2;
    note(access, `lab panels ${A} vs ${B} (${shown.length} series)`);
    return {
      content: {
        dateA: A,
        dateB: B,
        compared: rows.length,
        changed: rows.filter(r => r.changed).length,
        rows: render(),
        ...(wanted.length > shown.length ? { notReturned: wanted.length - shown.length, why: 'over the row or size limit; narrow with category or changedOnly' } : {}),
        ...(onlyA.length ? { onlyOnDateA: onlyA.slice(0, 40) } : {}),
        ...(onlyB.length ? { onlyOnDateB: onlyB.slice(0, 40) } : {}),
      },
    };
  },
};

export const DATA_TOOLS: AnalystTool[] = [listCapabilities, getMetrics, compareMetricPeriods, getMetricSeries, getRelationship, getWorkouts, getSleep, getBloodPressure, getLabResults, compareLabPanels, getMedications, getAppData];
