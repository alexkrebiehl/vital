/**
 * Blood pressure sparkline: two thin lines (systolic and diastolic) on ONE
 * shared scale, so their distance is the real gap between the numbers. Pure SVG,
 * no axes or values — the pair printed beside it is the information. Needs two
 * or more complete readings; with fewer it renders nothing rather than a flat
 * line that implies data. A reading missing either number is left out.
 */
export function BloodPressureSpark({
  readings, height = 40, className = '',
  systolicColor = 'var(--color-accent)', diastolicColor = 'var(--color-category-recovery)',
}: {
  readings: { systolic: number; diastolic: number }[];
  height?: number;
  className?: string;
  systolicColor?: string;
  diastolicColor?: string;
}) {
  const r = readings.filter(x => Number.isFinite(x.systolic) && Number.isFinite(x.diastolic));
  if (r.length < 2) return null;
  const W = 200, H = 48, pad = 3;
  const all = r.flatMap(x => [x.systolic, x.diastolic]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const path = (pick: (x: { systolic: number; diastolic: number }) => number) =>
    r
      .map((x, i) => `${i ? 'L' : 'M'}${((i / (r.length - 1)) * W).toFixed(1)} ${(H - pad - ((pick(x) - lo) / span) * (H - pad * 2)).toFixed(1)}`)
      .join('');
  const common = { fill: 'none', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ height, width: '100%', overflow: 'visible' }}
    >
      <path data-series="systolic" d={path(x => x.systolic)} stroke={systolicColor} {...common} />
      <path data-series="diastolic" d={path(x => x.diastolic)} stroke={diastolicColor} {...common} />
    </svg>
  );
}
