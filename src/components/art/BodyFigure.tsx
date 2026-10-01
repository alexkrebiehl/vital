import type { ReactNode } from 'react';

export type BodyAnchor = 'head' | 'heart' | 'lungs' | 'torso' | 'waist' | 'body' | 'legs';

/** Where each anchor sits on the 200×420 figure, in figure coordinates. */
const ANCHORS: Record<BodyAnchor, { x: number; y: number }> = {
  head: { x: 100, y: 38 },
  lungs: { x: 100, y: 112 },
  heart: { x: 112, y: 124 },
  torso: { x: 100, y: 150 },
  waist: { x: 100, y: 200 },
  body: { x: 100, y: 246 },
  legs: { x: 100, y: 330 },
};

export interface BodyMarker {
  id: string;
  anchor: BodyAnchor;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href?: string;
  /** CSS colour for the marker dot. */
  color?: string;
}

type P = [number, number];
interface Seg { c1: P; c2: P; p: P }

// Left half of the silhouette, from the top of the neck down the outside of the
// body to the crotch. The right half is the exact mirror, so the figure is
// symmetric by construction and there is no seam to stroke.
const START: P = [100, 66];
const LEFT: Seg[] = [
  { c1: [97, 66], c2: [95, 66], p: [93, 66] },
  { c1: [93, 74], c2: [92, 78], p: [84, 81] },
  { c1: [70, 85], c2: [58, 88], p: [52, 100] },
  { c1: [46, 112], c2: [44, 140], p: [40, 168] },
  { c1: [38, 186], c2: [36, 204], p: [34, 222] },
  { c1: [33, 232], c2: [36, 240], p: [42, 240] },
  { c1: [48, 240], c2: [50, 232], p: [51, 222] },
  { c1: [54, 200], c2: [58, 170], p: [64, 146] },
  { c1: [66, 160], c2: [66, 176], p: [68, 192] },
  { c1: [70, 204], c2: [70, 214], p: [68, 226] },
  { c1: [66, 250], c2: [70, 290], p: [72, 330] },
  { c1: [73, 360], c2: [72, 384], p: [72, 398] },
  { c1: [72, 408], c2: [76, 412], p: [86, 412] },
  { c1: [94, 412], c2: [97, 408], p: [97, 398] },
  { c1: [97, 370], c2: [98, 330], p: [100, 290] },
];

const mirror = (q: P): P => [200 - q[0], q[1]];
const pt = (q: P) => `${q[0]} ${q[1]}`;

function silhouette(): string {
  let d = `M${pt(START)}`;
  for (const s of LEFT) d += `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}`;
  for (let i = LEFT.length - 1; i >= 0; i--) {
    const from = i === 0 ? START : LEFT[i - 1].p;
    d += `C${pt(mirror(LEFT[i].c2))} ${pt(mirror(LEFT[i].c1))} ${pt(mirror(from))}`;
  }
  return d + 'Z';
}

const BODY_PATH = silhouette();

/**
 * A neutral, front-facing figure. It is an orientation aid, not a model of the
 * reader's body: nothing about it depends on sex, height or build, and it draws
 * only the markers it is given — a measurement that does not exist has no marker.
 */
export function BodyFigure({ markers, className = '' }: { markers: BodyMarker[]; className?: string }) {
  return (
    <svg
      viewBox="0 0 200 420"
      role="img"
      aria-label="Body outline with numbered markers for each measurement shown"
      className={className}
    >
      <defs>
        <linearGradient id="bf-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-surface)" />
          <stop offset="100%" stopColor="var(--color-surface-muted)" />
        </linearGradient>
        <radialGradient id="bf-halo" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="200" rx="98" ry="205" fill="url(#bf-halo)" />
      <g fill="url(#bf-skin)" stroke="var(--color-border-strong)" strokeWidth="1.3" strokeLinejoin="round">
        <ellipse cx="100" cy="37" rx="19" ry="23" />
        <path d={BODY_PATH} />
      </g>
      <g fill="none" stroke="var(--color-border-strong)" strokeWidth="1" strokeLinecap="round" opacity="0.7">
        <path d="M82 96c6 6 12 8 18 8s12-2 18-8" />
        <path d="M100 104v78" strokeDasharray="1 4" />
        <path d="M78 196c14 6 30 6 44 0" />
      </g>
      {markers.map((m, i) => {
        const p = ANCHORS[m.anchor];
        // Stagger markers that share an anchor so they never stack.
        const same = markers.slice(0, i).filter(o => o.anchor === m.anchor).length;
        const x = p.x + (same % 2 === 0 ? 1 : -1) * Math.ceil(same / 2) * 24;
        return (
          <g key={m.id} transform={`translate(${x} ${p.y})`}>
            <circle r="15" fill={m.color ?? 'var(--color-accent)'} opacity="0.16" />
            <circle r="10" fill={m.color ?? 'var(--color-accent)'} stroke="var(--color-surface)" strokeWidth="2" />
            <text y="3.8" textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff">{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
