// ── Route coverage: many GPS tracks → one set of paths ──
//
// The goal is a COVERAGE view: given every workout route inside a box, produce
// the union of streets travelled, not one squiggle per session.
//
// * Grid snapping, not geometric buffering. Each point is rounded to a cell of
//   `toleranceM` on a side, so two tracks on opposite sidewalks of one street
//   land in the same cells and collapse into one path. O(n), no geometry library.
// * Undirected edges. A segment is keyed on the sorted pair of its cells, so a
//   street walked north-to-south and later south-to-north is ONE segment with a
//   count of 2.
// * One count per workout per segment: pacing back and forth along a street in
//   one session still counts as one pass.
// * A break in the point sequence is a break in the path: a route that leaves
//   the box and re-enters is not joined by a straight line across it.
// * Chaining. Segments are dissolved back into long polylines, broken only at
//   junctions and where the drawn properties (count, activity types) change.
//   Heart rate stays out of that rule; it is accumulated per CELL and emitted one
//   value per vertex, which is exactly what shading along a line needs and leaves
//   the chaining untouched.
// * Edges remember their history. Every workout of the selected types feeds the
//   aggregation whatever its date, so each edge knows the first day it was ever
//   used; only workouts inside the date range count towards what is drawn. One
//   pass therefore serves both the map and "new ground this period".
//
// A port of health-export-api's geo.py, which this design was proven in.
//
// Pure: no I/O. The route store supplies the routes.

import type { BBox } from './types';
import { M_PER_DEG_LAT } from './types';
import { MICRO, type CompactRoute } from './route-data';
import { pathMetric, scaleFor, type MetricScale, type PathMetricId } from './metrics';

export interface CoverageQuery {
  bbox: BBox;
  /** Activity types to draw; null for every type. */
  types: string[] | null;
  /** Inclusive day-key range; null for all time. */
  range: { fromKey: string; toKey: string } | null;
  metric: PathMetricId;
  /** First day counted as "new ground". */
  newSinceKey: string;
  /** Override the size-derived snapping tolerance. */
  toleranceM?: number;
  maxVertices?: number;
  maxCells?: number;
}

export interface CoveragePath {
  /** Flat [lat, lon, lat, lon, …], 6 decimals. */
  coords: number[];
  count: number;
  types: string[];
  first: string;
  last: string;
  /** One value per vertex for a per-vertex metric (null where not measured). */
  values?: (number | null)[];
}

/**
 * A connected stretch of the map, found by threshold rather than by chain: the
 * busiest (or hardest) part that still adds up to a walkable length. GPS scatter
 * braids a well-used street into many short chains, so no single chain is long
 * enough to call a stretch; a connected set of edges is.
 */
export interface Stretch {
  /** The stretch as one or more polylines, each flat [lat, lon, …]. */
  lines: number[][];
  /** Every part of it was travelled at least this often. */
  count: number;
  lengthM: number;
  first: string;
  last: string;
  meanHeartRate: number | null;
}

export interface TypeTotals {
  type: string;
  workouts: number;
  seconds: number;
  distanceM: number;
}

export interface CoverageHighlights {
  totals: { workouts: number; seconds: number; distanceM: number; byType: TypeTotals[] };
  coverage: { uniqueDistanceM: number; newDistanceM: number; newSinceKey: string };
  favourite: Stretch | null;
  visits: { first: string | null; last: string | null };
  effort: {
    /** Time-weighted mean over in-box time with a reading. */
    meanHeartRate: number | null;
    /** Share of in-box time that had a heart-rate reading, 0..1. */
    measuredShare: number;
    hardest: Stretch | null;
  };
}

export interface CoverageResult {
  paths: CoveragePath[];
  scale: MetricScale | null;
  toleranceM: number;
  /** True when the least-travelled paths were dropped to fit the vertex budget. */
  truncated: boolean;
  /** Every activity type with a route in the box inside the range, whatever the filter. */
  types: { type: string; workouts: number }[];
  highlights: CoverageHighlights;
}

export const MIN_TOLERANCE_M = 5;
export const MAX_AUTO_TOLERANCE_M = 50;
export const MAX_TOLERANCE_M = 400;
/** Coarsening to fit the vertex budget stops here; past it, the least-travelled paths are dropped instead. */
export const MAX_BUDGET_TOLERANCE_M = 100;
export const DEFAULT_MAX_VERTICES = 30_000;
export const DEFAULT_MAX_CELLS = 400_000;
/** Consecutive points further apart in time are a pause or lost signal, not travel. */
export const MAX_GAP_SECONDS = 60;
/** A highlighted stretch is at least this long, when the map has one that long. */
export const MIN_STRETCH_M = 200;

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The snapping cell for a box: ~1/1000 of its diagonal, within 5-50 m. */
export function autoTolerance(bbox: BBox): number {
  const midLat = (bbox.north + bbox.south) / 2;
  const w = (bbox.east - bbox.west) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const h = (bbox.north - bbox.south) * M_PER_DEG_LAT;
  const diag = Math.hypot(w, h);
  return Math.min(MAX_AUTO_TOLERANCE_M, Math.max(MIN_TOLERANCE_M, Math.round(diag / 1000)));
}

// ── Aggregation ─────────────────────────────────────────

interface CellAcc {
  latSum: number;
  lonSum: number;
  n: number;
  hrSum: number;
  hrN: number;
}

interface EdgeStat {
  a: number;
  b: number;
  count: number;
  types: Set<string>;
  firstEver: string;
  firstInRange: string;
  lastInRange: string;
}

/** Cells are indexed relative to the box's south-west corner, so keys stay small and positive. */
const CELL_STRIDE = 2 ** 21;

class CellBudgetExceeded extends Error {}

interface Aggregation {
  cells: Map<number, CellAcc>;
  edges: Map<string, EdgeStat>;
  types: Map<string, Set<string>>;
  totals: Map<string, TypeTotals>;
  visits: { first: string | null; last: string | null };
  hr: { sum: number; weight: number };
  inBoxSeconds: number;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function inRange(dayKey: string, range: CoverageQuery['range']): boolean {
  return !range || (dayKey >= range.fromKey && dayKey <= range.toKey);
}

function aggregate(routes: CompactRoute[], q: CoverageQuery, toleranceM: number, maxCells: number): Aggregation {
  const s = Math.round(q.bbox.south * MICRO);
  const n = Math.round(q.bbox.north * MICRO);
  const w = Math.round(q.bbox.west * MICRO);
  const e = Math.round(q.bbox.east * MICRO);
  const midLat = (q.bbox.north + q.bbox.south) / 2;
  // Cell size in microdegrees, derived once from the box centre so cells stay a
  // uniform shape across it rather than shearing with each point's latitude.
  const dLat = (toleranceM / M_PER_DEG_LAT) * MICRO;
  const dLon = (toleranceM / (M_PER_DEG_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6))) * MICRO;
  const wanted = q.types ? new Set(q.types) : null;

  const agg: Aggregation = {
    cells: new Map(),
    edges: new Map(),
    types: new Map(),
    totals: new Map(),
    visits: { first: null, last: null },
    hr: { sum: 0, weight: 0 },
    inBoxSeconds: 0,
  };

  for (const route of routes) {
    const b = route.bounds;
    if (b.north < s || b.south > n || b.east < w || b.west > e) continue;
    const current = inRange(route.dayKey, q.range);
    const selected = !wanted || wanted.has(route.workoutType);
    if (!selected) {
      // Not drawn, but the type still belongs in the filter's list of choices.
      if (current) {
        for (let i = 0; i < route.lat.length; i++) {
          const la = route.lat[i];
          const lo = route.lon[i];
          if (la >= s && la <= n && lo >= w && lo <= e) {
            addType(agg, route);
            break;
          }
        }
      }
      continue;
    }

    const routeEdges = new Set<string>();
    let any = false;
    let prevIn = false;
    let prevCell = -1;
    let seconds = 0;
    let distance = 0;
    for (let i = 0; i < route.lat.length; i++) {
      const la = route.lat[i];
      const lo = route.lon[i];
      if (la < s || la > n || lo < w || lo > e) {
        prevIn = false;
        continue;
      }
      any = true;
      const cy = Math.round((la - s) / dLat);
      const cx = Math.round((lo - w) / dLon);
      const cell = cy * CELL_STRIDE + cx;
      let acc = agg.cells.get(cell);
      if (!acc) {
        if (agg.cells.size >= maxCells) throw new CellBudgetExceeded();
        acc = { latSum: 0, lonSum: 0, n: 0, hrSum: 0, hrN: 0 };
        agg.cells.set(cell, acc);
      }
      acc.latSum += la;
      acc.lonSum += lo;
      acc.n += 1;
      const bpm = route.hr[i];
      if (current && bpm > 0) {
        // Every point in the cell, across every workout in range, contributes:
        // the mean is over traversals, not over one outing. Collected whatever
        // the colour metric, because the Effort highlights read it too.
        acc.hrSum += bpm;
        acc.hrN += 1;
      }
      if (prevIn) {
        if (cell !== prevCell) routeEdges.add(edgeKey(prevCell, cell));
        if (current) {
          const dt = route.t[i] - route.t[i - 1];
          if (dt <= MAX_GAP_SECONDS) {
            seconds += dt;
            distance += haversineM(route.lat[i - 1] / MICRO, route.lon[i - 1] / MICRO, la / MICRO, lo / MICRO);
            agg.inBoxSeconds += dt;
            if (bpm > 0) {
              agg.hr.sum += bpm * dt;
              agg.hr.weight += dt;
            }
          }
        }
      }
      prevIn = true;
      prevCell = cell;
    }
    if (!any) continue;

    for (const key of routeEdges) {
      let stat = agg.edges.get(key);
      if (!stat) {
        const [a, bb] = key.split(':').map(Number);
        stat = { a, b: bb, count: 0, types: new Set(), firstEver: route.dayKey, firstInRange: '', lastInRange: '' };
        agg.edges.set(key, stat);
      }
      if (route.dayKey < stat.firstEver) stat.firstEver = route.dayKey;
      if (current) {
        stat.count += 1;
        stat.types.add(route.workoutType);
        if (!stat.firstInRange || route.dayKey < stat.firstInRange) stat.firstInRange = route.dayKey;
        if (route.dayKey > stat.lastInRange) stat.lastInRange = route.dayKey;
      }
    }
    if (current) {
      addType(agg, route);
      const t = agg.totals.get(route.workoutType) ?? { type: route.workoutType, workouts: 0, seconds: 0, distanceM: 0 };
      t.workouts += 1;
      t.seconds += seconds;
      t.distanceM += distance;
      agg.totals.set(route.workoutType, t);
      if (!agg.visits.first || route.dayKey < agg.visits.first) agg.visits.first = route.dayKey;
      if (!agg.visits.last || route.dayKey > agg.visits.last) agg.visits.last = route.dayKey;
    }
  }
  return agg;
}

function addType(agg: Aggregation, route: CompactRoute): void {
  const ids = agg.types.get(route.workoutType) ?? new Set<string>();
  ids.add(route.workoutId);
  agg.types.set(route.workoutType, ids);
}

// ── Chaining ────────────────────────────────────────────

function signature(stat: EdgeStat): string {
  return `${stat.count}|${[...stat.types].sort().join('\u0000')}`;
}

/**
 * Dissolve the drawn edges into maximal polylines of uniform properties, or with
 * `uniform`, into polylines broken only at junctions.
 */
export function chainEdges(edges: EdgeStat[], uniform = false): number[][] {
  const adjacency = new Map<number, number[]>();
  const byKey = new Map<string, EdgeStat>();
  for (const edge of edges) {
    byKey.set(edgeKey(edge.a, edge.b), edge);
    (adjacency.get(edge.a) ?? adjacency.set(edge.a, []).get(edge.a)!).push(edge.b);
    (adjacency.get(edge.b) ?? adjacency.set(edge.b, []).get(edge.b)!).push(edge.a);
  }
  const isBreak = (cell: number): boolean => {
    const nb = adjacency.get(cell)!;
    if (nb.length !== 2) return true;
    if (uniform) return false;
    return signature(byKey.get(edgeKey(cell, nb[0]))!) !== signature(byKey.get(edgeKey(cell, nb[1]))!);
  };
  const visited = new Set<string>();
  const walk = (start: number, firstHop: number): number[] => {
    visited.add(edgeKey(start, firstHop));
    const chain = [start, firstHop];
    let previous = start;
    let node = firstHop;
    while (!isBreak(node)) {
      // Exactly two distinct neighbours here: edges are unique unordered pairs
      // and a cell is never adjacent to itself.
      const following = adjacency.get(node)!.find(c => c !== previous)!;
      const key = edgeKey(node, following);
      if (visited.has(key)) break; // closed a loop back onto the start
      visited.add(key);
      chain.push(following);
      previous = node;
      node = following;
    }
    return chain;
  };
  const chains: number[][] = [];
  for (const cell of adjacency.keys()) {
    if (!isBreak(cell)) continue;
    for (const nb of adjacency.get(cell)!) {
      if (!visited.has(edgeKey(cell, nb))) chains.push(walk(cell, nb));
    }
  }
  // What is left is a closed ring of uniform properties with no break to start
  // from, so begin anywhere on it.
  for (const edge of edges) {
    if (!visited.has(edgeKey(edge.a, edge.b))) chains.push(walk(edge.a, edge.b));
  }
  return chains;
}

// ── Stretches ───────────────────────────────────────────

/**
 * The connected set of edges with the highest threshold value that still
 * reaches MIN_STRETCH_M (or, on a small map, the whole connected length).
 *
 * Edges are added in descending order of value, union-find style; the first
 * time a component reaches the target, every edge in it has a value at least
 * the threshold just added, and no higher threshold has a component that long.
 * Edges of equal value are added together, so ties are not decided by order.
 */
export function strongestStretch(
  edges: EdgeStat[],
  value: (e: EdgeStat) => number | null,
  length: (e: EdgeStat) => number
): EdgeStat[] | null {
  const items = edges
    .map(e => ({ e, v: value(e) }))
    .filter((x): x is { e: EdgeStat; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v);
  if (items.length === 0) return null;
  const total = items.reduce((s, x) => s + length(x.e), 0);
  const target = Math.min(MIN_STRETCH_M, total);

  const parent = new Map<number, number>();
  /** Total edge length per component root (also the union-by-size weight). */
  const size = new Map<number, number>();
  const find = (c: number): number => {
    let r = c;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = c;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const add = (c: number) => {
    if (!parent.has(c)) {
      parent.set(c, c);
      size.set(c, 0);
    }
  };

  // Only a component touched by the current group can newly reach the target.
  let touched: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const { e } = items[i];
    add(e.a);
    add(e.b);
    let ra = find(e.a);
    let rb = find(e.b);
    if (ra !== rb) {
      if (size.get(ra)! < size.get(rb)!) [ra, rb] = [rb, ra];
      parent.set(rb, ra);
      size.set(ra, size.get(ra)! + size.get(rb)!);
    }
    size.set(ra, size.get(ra)! + length(e));
    touched.push(ra);
    const groupEnds = i === items.length - 1 || items[i + 1].v !== items[i].v;
    if (!groupEnds) continue;
    // Any component that reached the target with this group is the answer; the
    // longest wins when several did.
    let best: number | null = null;
    for (const t of touched) {
      const r = find(t);
      if (size.get(r)! >= target && (best === null || size.get(r)! > size.get(best)!)) best = r;
    }
    touched = [];
    if (best !== null) return items.slice(0, i + 1).filter(x => find(x.e.a) === best).map(x => x.e);
  }
  return null;
}

// ── Output ──────────────────────────────────────────────

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function emptyResult(q: CoverageQuery, toleranceM: number): CoverageResult {
  return {
    paths: [],
    scale: null,
    toleranceM,
    truncated: false,
    types: [],
    highlights: {
      totals: { workouts: 0, seconds: 0, distanceM: 0, byType: [] },
      coverage: { uniqueDistanceM: 0, newDistanceM: 0, newSinceKey: q.newSinceKey },
      favourite: null,
      visits: { first: null, last: null },
      effort: { meanHeartRate: null, measuredShare: 0, hardest: null },
    },
  };
}

/** The coverage of a box: drawable paths, the colour scale and the highlights. */
export function computeCoverage(routes: CompactRoute[], q: CoverageQuery): CoverageResult {
  const maxVertices = q.maxVertices ?? DEFAULT_MAX_VERTICES;
  const maxCells = q.maxCells ?? DEFAULT_MAX_CELLS;
  let toleranceM = q.toleranceM ?? autoTolerance(q.bbox);

  // A grid too fine for the area is abandoned as soon as it is known to be
  // hopeless and retried coarser, rather than filling the heap.
  for (;;) {
    let agg: Aggregation;
    try {
      agg = aggregate(routes, q, toleranceM, maxCells);
    } catch (error) {
      if (error instanceof CellBudgetExceeded && toleranceM * 2 <= MAX_TOLERANCE_M) {
        toleranceM *= 2;
        continue;
      }
      if (error instanceof CellBudgetExceeded) return emptyResult(q, toleranceM);
      throw error;
    }
    const drawn = [...agg.edges.values()].filter(e => e.count > 0);
    const chains = chainEdges(drawn);
    const vertices = chains.reduce((sum, c) => sum + c.length, 0);
    if (vertices > maxVertices && toleranceM * 2 <= MAX_BUDGET_TOLERANCE_M && q.toleranceM === undefined) {
      toleranceM *= 2;
      continue;
    }
    return finish(agg, drawn, chains, q, toleranceM, maxVertices);
  }
}

function finish(
  agg: Aggregation,
  drawn: EdgeStat[],
  chains: number[][],
  q: CoverageQuery,
  toleranceM: number,
  maxVertices: number
): CoverageResult {
  const metric = pathMetric(q.metric);
  const coord = new Map<number, [number, number]>();
  const at = (cell: number): [number, number] => {
    let c = coord.get(cell);
    if (!c) {
      const acc = agg.cells.get(cell)!;
      // The representative coordinate is the running mean, so a cell shared
      // between paths always resolves to one point and the lines join up.
      c = [acc.latSum / acc.n / MICRO, acc.lonSum / acc.n / MICRO];
      coord.set(cell, c);
    }
    return c;
  };
  const hrAt = (cell: number): number | null => {
    const acc = agg.cells.get(cell)!;
    return acc.hrN > 0 ? acc.hrSum / acc.hrN : null;
  };
  const edgeLength = (a: number, b: number): number => {
    const [la1, lo1] = at(a);
    const [la2, lo2] = at(b);
    return haversineM(la1, lo1, la2, lo2);
  };
  const byKey = new Map(drawn.map(e => [edgeKey(e.a, e.b), e]));

  interface Built {
    chain: number[];
    path: CoveragePath;
  }
  const built: Built[] = chains.map(chain => {
    const stats = chain.slice(1).map((cell, i) => byKey.get(edgeKey(chain[i], cell))!);
    const path: CoveragePath = {
      coords: chain.flatMap(c => at(c).map(round6)),
      count: Math.max(...stats.map(s => s.count)),
      types: [...new Set(stats.flatMap(s => [...s.types]))].sort(),
      first: stats.reduce((m, s) => (s.firstInRange < m ? s.firstInRange : m), stats[0].firstInRange),
      last: stats.reduce((m, s) => (s.lastInRange > m ? s.lastInRange : m), stats[0].lastInRange),
    };
    if (metric.source === 'vertex-mean') path.values = chain.map(hrAt).map(v => (v == null ? null : Math.round(v)));
    return { chain, path };
  });

  // Highlights read the whole aggregation, before any trimming for the budget.
  const lengths = new Map<EdgeStat, number>();
  let uniqueDistanceM = 0;
  let newDistanceM = 0;
  for (const edge of drawn) {
    const len = edgeLength(edge.a, edge.b);
    lengths.set(edge, len);
    uniqueDistanceM += len;
    if (edge.firstEver >= q.newSinceKey) newDistanceM += len;
  }
  const edgeHr = (e: EdgeStat): number | null => {
    const a = hrAt(e.a);
    const b = hrAt(e.b);
    return a == null ? b : b == null ? a : (a + b) / 2;
  };
  const toStretch = (edges: EdgeStat[] | null): Stretch | null => {
    if (!edges || edges.length === 0) return null;
    let lengthM = 0;
    let hrSum = 0;
    let hrLen = 0;
    for (const e of edges) {
      const len = lengths.get(e)!;
      lengthM += len;
      const hr = edgeHr(e);
      if (hr != null) {
        hrSum += hr * len;
        hrLen += len;
      }
    }
    return {
      lines: chainEdges(edges, true).map(chain => chain.flatMap(c => at(c).map(round6))),
      count: Math.min(...edges.map(e => e.count)),
      lengthM,
      first: edges.reduce((m, e) => (e.firstInRange < m ? e.firstInRange : m), edges[0].firstInRange),
      last: edges.reduce((m, e) => (e.lastInRange > m ? e.lastInRange : m), edges[0].lastInRange),
      meanHeartRate: hrLen > 0 ? Math.round(hrSum / hrLen) : null,
    };
  };
  const favourite = toStretch(strongestStretch(drawn, e => e.count, e => lengths.get(e)!));
  const hardest = toStretch(strongestStretch(drawn, edgeHr, e => lengths.get(e)!));

  const byType = [...agg.totals.values()].sort((a, b) => b.workouts - a.workouts || a.type.localeCompare(b.type));
  const totals = byType.reduce(
    (t, x) => ({ workouts: t.workouts + x.workouts, seconds: t.seconds + x.seconds, distanceM: t.distanceM + x.distanceM }),
    { workouts: 0, seconds: 0, distanceM: 0 }
  );

  // Frequently travelled paths matter most to a coverage map, so a path that
  // does not fit the budget is dropped least-travelled first.
  let kept = built;
  let truncated = false;
  const vertexCount = built.reduce((s, b) => s + b.chain.length, 0);
  if (vertexCount > maxVertices) {
    truncated = true;
    kept = [];
    let used = 0;
    for (const b of [...built].sort((x, y) => y.path.count - x.path.count)) {
      if (used + b.chain.length > maxVertices) continue;
      kept.push(b);
      used += b.chain.length;
    }
  }

  const paths = kept.map(b => b.path);
  const scaleValues =
    metric.source === 'edge-count'
      ? paths.map(p => p.count)
      : paths.flatMap(p => (p.values ?? []).filter((v): v is number => v != null));

  return {
    paths,
    scale: scaleFor(metric, scaleValues),
    toleranceM,
    truncated,
    types: [...agg.types.entries()]
      .map(([type, ids]) => ({ type, workouts: ids.size }))
      .sort((a, b) => b.workouts - a.workouts || a.type.localeCompare(b.type)),
    highlights: {
      totals: { ...totals, byType },
      coverage: { uniqueDistanceM, newDistanceM, newSinceKey: q.newSinceKey },
      favourite,
      visits: agg.visits,
      effort: {
        meanHeartRate: agg.hr.weight > 0 ? Math.round(agg.hr.sum / agg.hr.weight) : null,
        measuredShare: agg.inBoxSeconds > 0 ? agg.hr.weight / agg.inBoxSeconds : 0,
        hardest,
      },
    },
  };
}
