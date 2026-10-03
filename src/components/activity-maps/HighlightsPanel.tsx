'use client';

// The figures beside a map, all for the selected activities and date range
// inside the map's area: totals, coverage, the favourite stretch and effort.
// Hovering (or focusing) a stretch lights it up on the map.

import type { ReactNode } from 'react';
import type { CoverageHighlights, Stretch } from '@/lib/activity-maps/coverage';
import { formatDistance, formatSeconds } from '@/lib/activity-maps/format';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import type { UnitSystem } from '@/lib/prefs/types';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className="text-lg font-semibold tracking-[-0.02em] text-text-primary tnum">{value}</div>
      {sub && <div className="text-[11px] text-text-secondary">{sub}</div>}
    </div>
  );
}

function StretchRow({
  label,
  stretch,
  detail,
  onEmphasis,
}: {
  label: string;
  stretch: Stretch;
  detail: string;
  onEmphasis: (lines: number[][] | null) => void;
}) {
  return (
    <button
      type="button"
      className="w-full rounded-control border border-border px-3 py-2 text-left hover:border-border-strong hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      onMouseEnter={() => onEmphasis(stretch.lines)}
      onMouseLeave={() => onEmphasis(null)}
      onFocus={() => onEmphasis(stretch.lines)}
      onBlur={() => onEmphasis(null)}
      onClick={() => onEmphasis(stretch.lines)}
    >
      <span className="block text-xs text-text-primary">{label}</span>
      <span className="block text-[11px] text-text-secondary tnum">{detail}</span>
    </button>
  );
}

export function HighlightsPanel({
  highlights,
  units,
  onEmphasis,
}: {
  highlights: CoverageHighlights;
  units: UnitSystem;
  onEmphasis: (lines: number[][] | null) => void;
}) {
  const { totals, coverage, favourite, visits, effort } = highlights;
  if (totals.workouts === 0) {
    return <p className="text-sm text-text-secondary">No route of the selected activities enters this area in the selected range.</p>;
  }
  const span = (s: Stretch) => (s.first === s.last ? formatDayKeyShort(s.first) : `${formatDayKeyShort(s.first)} – ${formatDayKeyShort(s.last)}`);
  return (
    <div className="space-y-5">
      <Group title="Totals">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Workouts" value={totals.workouts.toLocaleString()} />
          <Figure label="Time here" value={formatSeconds(totals.seconds)} />
          <Figure label="Travelled" value={formatDistance(totals.distanceM, units)} />
        </div>
        {totals.byType.length > 1 && (
          <ul className="m-0 list-none space-y-1 p-0 text-[11px]">
            {totals.byType.map(t => (
              <li key={t.type} className="flex justify-between gap-2">
                <span className="truncate text-text-primary">{t.type}</span>
                <span className="shrink-0 text-text-secondary tnum">
                  {t.workouts} · {formatSeconds(t.seconds)} · {formatDistance(t.distanceM, units)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Coverage">
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Distinct ground" value={formatDistance(coverage.uniqueDistanceM, units)} sub="Each stretch counted once" />
          <Figure
            label="New ground"
            value={formatDistance(coverage.newDistanceM, units)}
            sub={`First travelled since ${formatDayKeyShort(coverage.newSinceKey)}`}
          />
        </div>
      </Group>

      <Group title="Favourite stretch">
        {favourite ? (
          <StretchRow
            label={`${formatDistance(favourite.lengthM, units)}, every part travelled ${favourite.count}× or more`}
            detail={span(favourite)}
            stretch={favourite}
            onEmphasis={onEmphasis}
          />
        ) : (
          <p className="text-xs text-text-secondary">No stretch stands out yet.</p>
        )}
        {visits.first && visits.last && (
          <p className="text-[11px] text-text-secondary">
            First here {formatDayKeyLong(visits.first)}
            {visits.last !== visits.first ? `; most recently ${formatDayKeyLong(visits.last)}` : ''}.
          </p>
        )}
      </Group>

      <Group title="Effort">
        {effort.meanHeartRate != null ? (
          <>
            <Figure
              label="Average heart rate here"
              value={`${effort.meanHeartRate} bpm`}
              sub={effort.measuredShare < 0.95 ? `Measured for ${Math.round(effort.measuredShare * 100)}% of the time here` : undefined}
            />
            {effort.hardest && effort.hardest.meanHeartRate != null && (
              <StretchRow
                label={`Hardest stretch: ~${effort.hardest.meanHeartRate} bpm`}
                detail={`${formatDistance(effort.hardest.lengthM, units)} · ${span(effort.hardest)}`}
                stretch={effort.hardest}
                onEmphasis={onEmphasis}
              />
            )}
          </>
        ) : (
          <p className="text-xs text-text-secondary">No heart rate was recorded on these routes.</p>
        )}
      </Group>
    </div>
  );
}
