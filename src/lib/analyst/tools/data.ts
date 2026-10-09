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

import { scrubForModel } from '../scrub';
import { resolveMetric } from './metric-resolve';
import { getMetricSeries } from './series-tool';
import { getBloodPressure, getSleep, getWorkouts } from './records-tools';
import { getMedications } from './medications-tool';
import { getAppData } from './app-data-tool';
import { listCapabilities } from './list-capabilities';
import { formatMetricWithUnit } from '../../metrics/format';
import { makeWindow } from '../../analytics/windows';
import { resolveWindow, WINDOW_SCHEMA } from '../capabilities/window';
import { labInWindow, namesNotInWindow } from '../capabilities/reads/lab-window';
import { analyteRequestedBy, changeText, readingText, seriesSnapshot, toReading, type LabSeriesInput } from '../labSnapshot';
import { MAX_POINTS_PER_SERIES, pairFor } from '../retrieval';
import type { DataAccess } from '../dataAccess';
import type { AnalystTool, ToolContext, ToolOutcome } from './index';

/** A data tool's result, in characters of JSON. Under the loop's own 14,000 cut-off, so nothing is ever sliced. */
export const MAX_DATA_RESULT_CHARS = 12_000;
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

function note(access: DataAccess, line: string): void {
  access.fetched.log.push(line);
}

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

export const DATA_TOOLS: AnalystTool[] = [listCapabilities, getMetricSeries, getRelationship, getWorkouts, getSleep, getBloodPressure, getLabResults, compareLabPanels, getMedications, getAppData];
