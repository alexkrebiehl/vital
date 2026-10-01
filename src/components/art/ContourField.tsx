import { useId, useMemo } from 'react';
import { CATEGORY_VAR, type ArtCategory } from './categories';

/**
 * Generative contour artwork — purely ornamental, deliberately NOT chart-like
 * (no axes, no ticks, no values). Deterministic per `seed`, so a page looks the
 * same on every render and on the server and the client.
 */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Props {
  category?: ArtCategory;
  seed?: number;
  lines?: number;
  className?: string;
}

export function ContourField({ category = 'neutral', seed = 7, lines = 15, className = '' }: Props) {
  const gid = useId().replace(/:/g, '');
  const color = CATEGORY_VAR[category];

  const paths = useMemo(() => {
    const r = rng(seed * 9973 + 11);
    const a1 = 26 + r() * 22, a2 = 10 + r() * 14;
    const f1 = 0.011 + r() * 0.008, f2 = 0.028 + r() * 0.014;
    const p1 = r() * 6.28, p2 = r() * 6.28;
    const drift = 0.75 + r() * 0.5;
    const out: { d: string; o: number; w: number }[] = [];
    for (let i = 0; i < lines; i++) {
      const base = 30 + i * (250 / lines);
      const k = i / lines;
      let d = '';
      for (let x = 0; x <= 640; x += 16) {
        const y =
          base +
          Math.sin(x * f1 + p1 + k * 2.4 * drift) * a1 * (0.55 + k) +
          Math.sin(x * f2 + p2 - k * 3) * a2;
        d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`;
      }
      out.push({ d, o: 0.12 + (1 - Math.abs(k - 0.45)) * 0.42, w: i % 5 === 0 ? 1.6 : 1 });
    }
    return out;
  }, [seed, lines]);

  return (
    <svg
      viewBox="0 0 640 320"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
    >
      <defs>
        <radialGradient id={`${gid}-orb`} cx="78%" cy="18%" r="62%">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${gid}-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${gid}-m`}>
          <rect width="640" height="320" fill={`url(#${gid}-fade)`} />
        </mask>
      </defs>
      <rect width="640" height="320" fill={`url(#${gid}-orb)`} />
      <g mask={`url(#${gid}-m)`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        {paths.map((p, i) => (
          <path key={i} d={p.d} strokeOpacity={p.o} strokeWidth={p.w} />
        ))}
      </g>
    </svg>
  );
}
