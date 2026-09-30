import { useId } from 'react';

/**
 * A quiet area sparkline. Pure SVG, no axes or values: the number it sits beside
 * is the information, the line only shows the shape. Needs two or more points;
 * with fewer it renders nothing rather than a flat line that implies data.
 */
export function Spark({
  values, color = 'var(--color-accent)', height = 44, className = '',
}: { values: number[]; color?: string; height?: number; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const W = 200, H = 48, pad = 3;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((y, i) => [
    (i / (v.length - 1)) * W,
    H - pad - ((y - lo) / span) * (H - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ height, width: '100%', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W} ${H}L0 ${H}Z`} fill={`url(#${gid}-a)`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {/* A zero-length round-capped stroke is a true circle under a non-uniform scale. */}
      <path d={`M${last[0]} ${last[1]}h0.01`} stroke="var(--color-surface)" strokeWidth="9" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={`M${last[0]} ${last[1]}h0.01`} stroke={color} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
