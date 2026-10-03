import { describe, expect, it } from 'vitest';
import { autoTolerance, computeCoverage, haversineM, type CoverageQuery } from './coverage';
import { compactRoute, type CompactRoute, type HeartRateSample } from './route-data';
import { M_PER_DEG_LAT, bboxAround } from './types';

const LAT = 40;
const LON = -80;
const M_LON = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);

/** A point `x` metres east and `y` metres north of the origin. */
function at(x: number, y: number): [number, number] {
  return [LAT + y / M_PER_DEG_LAT, LON + x / M_LON];
}

let seq = 0;
function route(
  xy: [number, number][],
  opts: { type?: string; day?: string; stepS?: number; hr?: HeartRateSample[] } = {}
): CompactRoute {
  const start = Date.parse(`${opts.day ?? '2026-09-01'}T12:00:00Z`);
  const step = opts.stepS ?? 2;
  const points = xy.map(([x, y], i) => {
    const [lat, lon] = at(x, y);
    return { latitude: lat, longitude: lon, time: new Date(start + i * step * 1000).toISOString() };
  });
  return compactRoute(
    { workoutId: `w${++seq}`, workoutType: opts.type ?? 'Walk', start: new Date(start).toISOString(), dayKey: opts.day ?? '2026-09-01' },
    points,
    opts.hr ?? []
  )!;
}

/** A straight line from (x0, y) to (x1, y), a point every `every` metres. */
function line(x0: number, x1: number, y = 0, every = 5): [number, number][] {
  const out: [number, number][] = [];
  const dir = x1 >= x0 ? 1 : -1;
  for (let x = x0; dir > 0 ? x <= x1 : x >= x1; x += dir * every) out.push([x, y]);
  return out;
}

const BOX = bboxAround(LAT, LON, 3000);

function query(extra: Partial<CoverageQuery> = {}): CoverageQuery {
  return { bbox: BOX, types: null, range: null, metric: 'frequency', newSinceKey: '2026-08-01', toleranceM: 10, ...extra };
}

describe('computeCoverage', () => {
  it('collapses both sides of a street and both directions into one path counted twice', () => {
    const out = computeCoverage([route(line(0, 500, 0)), route(line(500, 0, 3))], query());
    expect(out.paths).toHaveLength(1);
    expect(out.paths[0].count).toBe(2);
    expect(out.highlights.totals.workouts).toBe(2);
  });

  it('counts pacing back and forth in one workout as one pass', () => {
    const out = computeCoverage([route([...line(0, 300), ...line(300, 0), ...line(0, 300)])], query());
    expect(Math.max(...out.paths.map(p => p.count))).toBe(1);
  });

  it('does not join a route that leaves the box and re-enters with a straight line', () => {
    const small = bboxAround(LAT, LON, 400);
    // East along y=0 inside, out north well past the box, back down further east.
    const xy: [number, number][] = [...line(-150, -20), [-20, 500], [100, 500], ...line(100, 150)];
    const out = computeCoverage([route(xy)], query({ bbox: small }));
    for (const p of out.paths) {
      for (let i = 2; i < p.coords.length; i += 2) {
        expect(haversineM(p.coords[i - 2], p.coords[i - 1], p.coords[i], p.coords[i + 1])).toBeLessThan(40);
      }
    }
    expect(out.paths.length).toBeGreaterThanOrEqual(2);
  });

  it('draws only the range but remembers when each stretch was first travelled', () => {
    const old = route(line(0, 500), { day: '2026-01-10' });
    const repeat = route(line(0, 500), { day: '2026-09-02' });
    const fresh = route(line(0, 500, 400), { day: '2026-09-03' });
    const out = computeCoverage(
      [old, repeat, fresh],
      query({ range: { fromKey: '2026-09-01', toKey: '2026-09-30' }, newSinceKey: '2026-09-01' })
    );
    expect(out.paths.every(p => p.count === 1)).toBe(true);
    expect(out.highlights.totals.workouts).toBe(2);
    // Only the y=400 street is new; the y=0 one was first walked in January.
    expect(out.highlights.coverage.newDistanceM).toBeGreaterThan(400);
    expect(out.highlights.coverage.newDistanceM).toBeLessThan(600);
    expect(out.highlights.coverage.uniqueDistanceM).toBeGreaterThan(900);
    expect(out.highlights.visits).toEqual({ first: '2026-09-02', last: '2026-09-03' });
  });

  it('leaves filtered-out activities off the map but keeps them as choices', () => {
    const out = computeCoverage(
      [route(line(0, 500), { type: 'Walk' }), route(line(0, 500, 300), { type: 'Ride' })],
      query({ types: ['Walk'] })
    );
    expect(out.paths.every(p => p.types.join() === 'Walk')).toBe(true);
    expect(out.types.map(t => t.type).sort()).toEqual(['Ride', 'Walk']);
  });

  it('measures distance and time in the box, skipping gaps longer than a minute', () => {
    const out = computeCoverage([route(line(0, 500), { stepS: 2 })], query());
    expect(out.highlights.totals.distanceM).toBeGreaterThan(490);
    expect(out.highlights.totals.distanceM).toBeLessThan(510);
    expect(out.highlights.totals.seconds).toBe(200);

    const paused = computeCoverage([route(line(0, 500), { stepS: 120 })], query());
    expect(paused.highlights.totals.seconds).toBe(0);
  });

  it('shades heart rate per vertex, null where nothing was measured', () => {
    const start = Date.parse('2026-09-01T12:00:00Z');
    const hr = [
      { timestamp: new Date(start).toISOString(), value: 100 },
      { timestamp: new Date(start + 200_000).toISOString(), value: 160 },
    ];
    const measured = computeCoverage([route(line(0, 500), { hr })], query({ metric: 'heart_rate' }));
    const values = measured.paths.flatMap(p => p.values ?? []);
    expect(values.length).toBeGreaterThan(10);
    expect(values.every(v => v != null && v >= 100 && v <= 160)).toBe(true);
    expect(measured.scale!.min).toBeGreaterThan(100);
    expect(measured.scale!.max).toBeLessThan(160);
    expect(measured.highlights.effort.meanHeartRate).toBeGreaterThan(120);
    expect(measured.highlights.effort.hardest?.meanHeartRate).toBeGreaterThan(120);

    const unmeasured = computeCoverage([route(line(0, 500))], query({ metric: 'heart_rate' }));
    expect(unmeasured.paths.flatMap(p => p.values ?? []).every(v => v === null)).toBe(true);
    expect(unmeasured.scale).toBeNull();
    expect(unmeasured.highlights.effort.meanHeartRate).toBeNull();
  });

  it('finds the busiest connected stretch even when scatter breaks it into short chains', () => {
    // A 400 m street walked 5 times, each pass on a different sidewalk offset so
    // the snapped tracks braid into many short chains of differing counts; and a
    // 1 km path walked once.
    const busy = [0, 2, 4, 6, 8].map(dy => route(line(0, 400, dy + (dy % 4 === 0 ? 0 : 3)), { day: '2026-09-02' }));
    const long = route(line(-1000, 0, 600));
    const out = computeCoverage([...busy, long], query());
    const fav = out.highlights.favourite!;
    expect(fav.count).toBeGreaterThan(1);
    expect(fav.lengthM).toBeGreaterThanOrEqual(200);
    expect(fav.lines.flat().every((v, i) => i % 2 === 1 || v < at(0, 300)[0])).toBe(true);
  });

  it('picks the most-travelled stretch as the favourite', () => {
    const out = computeCoverage(
      [route(line(0, 500)), route(line(0, 500)), route(line(0, 500)), route(line(0, 500, 300))],
      query()
    );
    expect(out.highlights.favourite?.count).toBe(3);
    expect(out.highlights.favourite!.lines.length).toBeGreaterThan(0);
    expect(out.highlights.favourite!.lengthM).toBeGreaterThan(400);
  });

  it('drops the least-travelled paths when the vertex budget is pinned', () => {
    const out = computeCoverage(
      [route(line(0, 500)), route(line(0, 500)), route(line(0, 500, 300))],
      query({ maxVertices: 60 })
    );
    expect(out.truncated).toBe(true);
    expect(out.paths.every(p => p.count === 2)).toBe(true);
  });

  it('coarsens the grid instead of exceeding the cell budget', () => {
    const out = computeCoverage([route(line(-1000, 1000, 0, 2))], query({ toleranceM: undefined, maxCells: 50 }));
    expect(out.toleranceM).toBeGreaterThan(autoTolerance(BOX));
    expect(out.paths.length).toBeGreaterThan(0);
  });

  it('closes a ring of uniform properties into one path', () => {
    const ring: [number, number][] = line(0, 195, 0);
    for (let y = 0; y <= 200; y += 5) ring.push([200, y]);
    for (let x = 200; x >= 0; x -= 5) ring.push([x, 200]);
    for (let y = 200; y >= 0; y -= 5) ring.push([0, y]);
    const out = computeCoverage([route(ring)], query());
    expect(out.paths).toHaveLength(1);
    const c = out.paths[0].coords;
    expect(haversineM(c[0], c[1], c[c.length - 2], c[c.length - 1])).toBeLessThan(1);
  });
});

describe('autoTolerance', () => {
  it('scales with the box and stays within 5-50 m', () => {
    expect(autoTolerance(bboxAround(LAT, LON, 500))).toBe(5);
    expect(autoTolerance(bboxAround(LAT, LON, 10_000))).toBe(14);
    expect(autoTolerance(bboxAround(LAT, LON, 200_000))).toBe(50);
  });
});
