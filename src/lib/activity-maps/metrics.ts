// ── Path metrics: what a coverage line's colour means ───
//
// One entry per metric. The aggregator collects what an entry's `source` says,
// the API returns only the selected metric's values, and the map colours and
// labels the lines from the entry, so adding a metric (pace, recency, …) is one
// entry here plus, for a per-point value, a sampler in the route store.
//
// Colour ramps are single-hue and ordinal-validated against the basemap surfaces
// with the dataviz validator (light: CARTO Positron ~#f2f2f0, dark: CARTO Dark
// Matter ~#262626): lightness is monotone, adjacent steps are >= 0.06 apart and
// the faint end still clears 2:1 against the map, so a one-off path never
// vanishes into the streets under it. Dark mode is its own selection, not a
// flip: the faint end is the dark step and the strong end the light one.
// Frequency is blue and heart rate orange, so the two never read as one scale.
//
// Pure: shared by the server (scales) and the browser (colours, legends).

export type PathMetricId = 'frequency' | 'heart_rate';

export interface PathMetric {
  id: PathMetricId;
  label: string;
  /** The legend's description of the value. */
  description: string;
  unit: string;
  /**
   * Where the value comes from: the number of workouts that used a segment, or a
   * per-vertex mean of a sampled channel across every traversal.
   */
  source: 'edge-count' | 'vertex-mean';
  /** Per-point channel the route store must provide. */
  sample?: 'heart_rate';
  scale: 'log' | 'linear';
  /** Percentiles the colour scale is clamped to, so one outlier cannot flatten the rest. */
  clamp?: [number, number];
  ramp: { light: string[]; dark: string[] };
  format: (value: number) => string;
}

/** "Not measured" is not the faint end of the ramp: it draws in a neutral grey (3.1:1 light, 4.4:1 dark). */
export const MISSING_COLOR = '#8a8a86';

export const PATH_METRICS: readonly PathMetric[] = [
  {
    id: 'frequency',
    label: 'Frequency',
    description: 'Workouts that used each stretch',
    unit: '×',
    source: 'edge-count',
    scale: 'log',
    ramp: {
      light: ['#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
      dark: ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'],
    },
    format: v => `${Math.round(v)}×`,
  },
  {
    id: 'heart_rate',
    label: 'Heart rate',
    description: 'Mean heart rate across every pass',
    unit: 'bpm',
    source: 'vertex-mean',
    sample: 'heart_rate',
    scale: 'linear',
    clamp: [5, 95],
    ramp: {
      light: ['#fd8453', '#e06b39', '#c5521c', '#a93800', '#8e1c00'],
      dark: ['#9a4825', '#bb6543', '#dd8461', '#ffa37f', '#ffc39f'],
    },
    format: v => `${Math.round(v)} bpm`,
  },
];

export const DEFAULT_PATH_METRIC: PathMetricId = 'frequency';

export function isPathMetricId(value: unknown): value is PathMetricId {
  return typeof value === 'string' && PATH_METRICS.some(m => m.id === value);
}

export function pathMetric(id: PathMetricId): PathMetric {
  return PATH_METRICS.find(m => m.id === id) ?? PATH_METRICS[0];
}

// ── Scales ──────────────────────────────────────────────

/** The domain a metric's colours span. */
export interface MetricScale {
  min: number;
  max: number;
}

/** Linear-interpolated percentile of an already sorted array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** The colour domain for the values on screen, or null when there are none. */
export function scaleFor(metric: PathMetric, values: number[]): MetricScale | null {
  const finite = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  if (metric.clamp) {
    const [lo, hi] = metric.clamp;
    return { min: percentile(finite, lo), max: percentile(finite, hi) };
  }
  return { min: metric.scale === 'log' ? Math.max(1, finite[0]) : finite[0], max: finite[finite.length - 1] };
}

/** Position of a value on the scale, 0..1 (clamped). */
export function scalePosition(metric: PathMetric, scale: MetricScale, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (scale.max <= scale.min) return 1;
  let t: number;
  if (metric.scale === 'log') {
    const lo = Math.log(Math.max(1, scale.min));
    const hi = Math.log(Math.max(1, scale.max));
    t = hi > lo ? (Math.log(Math.max(1, value)) - lo) / (hi - lo) : 1;
  } else {
    t = (value - scale.min) / (scale.max - scale.min);
  }
  return Math.min(1, Math.max(0, t));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The ramp colour at t (0..1), interpolated between the validated stops. */
export function rampColor(ramp: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const f = x - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
