'use client';

// ── Body → Nutrition: eating to the targets, at a glance ─
//
// The top of the Nutrition page, once a goal sets targets and food is logged:
// for calories and protein, how many complete logged days were on target or
// within the wider OK range over the last four weeks, and each day as a dot
// against both ranges. The target range is narrow on purpose, so the headline
// counts the OK range: a day a little off the target is still a fine day.
// Days without a log are marked as gaps, never zeros, and partial logs are
// shown hollow and left out of the counts. The counts describe the log; they
// are not a score.

import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { TREND_DAYS } from '@/lib/body-goal/constants';
import type { AdherenceDay } from '@/lib/body-goal/intake';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { Range } from '@/lib/body-goal/targets';
import { Card } from '@/components/ui/primitives';
import { SectionTitle } from '@/components/domain/DomainShared';
import { formatGrams, formatKcal, formatRange } from './format';

type Verdict = 'met' | 'ok' | 'above' | 'below';

const MET = 'var(--color-category-nutrition)';
/** OK days: the target colour, lighter. Dots also get a ring in the full colour, so the two read apart in every theme. */
const OK = 'color-mix(in srgb, var(--color-category-nutrition) 35%, transparent)';
const OFF = 'var(--color-category-attention)';

interface Measure {
  title: string;
  target: string;
  okTarget: string;
  /** Days on target, and days off target but within the OK range. */
  met: number;
  ok: number;
  of: number;
  okLabel: string;
  average: string;
  breakdown: string | null;
  band: Range;
  okBand: Range;
  values: { key: string; value: number | null; log: AdherenceDay['log'] }[];
  judge: (v: number) => Verdict;
  format: (v: number) => string;
  verdictText: Record<Verdict, string>;
  offLabel: string;
}

export function NutritionAdherence({ report }: { report: BodyGoalReport | null }) {
  const t = report?.targets;
  const a = report?.adherence;
  if (!report || !t || !a || a.completeDays === 0) return null;

  const measures: Measure[] = [];
  const cal = t.calories;
  const calOk = t.caloriesOk ?? cal;
  if (cal && calOk && a.caloriesInRange !== null) {
    const parts = [a.caloriesAbove ? `${a.caloriesAbove} above` : null, a.caloriesBelow ? `${a.caloriesBelow} below` : null].filter(Boolean);
    measures.push({
      title: 'Calories',
      target: `${formatRange(cal, 'kcal')} a day`,
      okTarget: formatRange(calOk, 'kcal'),
      met: a.caloriesInRange,
      ok: a.caloriesOk ?? 0,
      of: a.completeDays,
      okLabel: 'within the OK range',
      average: formatKcal(a.averages.kcal),
      breakdown: parts.length ? `${parts.join(' · ')} the OK range` : null,
      band: cal,
      okBand: calOk,
      values: a.days.map(d => ({ key: d.key, value: d.kcal, log: d.log })),
      judge: v => (v >= cal.min && v <= cal.max ? 'met' : v > calOk.max ? 'above' : v < calOk.min ? 'below' : 'ok'),
      format: v => formatKcal(v),
      verdictText: { met: 'on target', ok: 'OK, close to the target', above: 'above the OK range', below: 'below the OK range' },
      offLabel: 'outside the OK range',
    });
  }
  if (a.proteinDays > 0) {
    const under = a.proteinDays - a.proteinAtFloor - a.proteinOk;
    const okFloor = t.proteinOkFloor;
    measures.push({
      title: 'Protein',
      target: `${formatRange(t.protein, 'g')} a day`,
      okTarget: `${okFloor} g or more`,
      met: a.proteinAtFloor,
      ok: a.proteinOk,
      of: a.proteinDays,
      okLabel: `at ${okFloor} g or more`,
      average: formatGrams(a.averages.protein),
      breakdown: under ? `${under} under ${okFloor} g` : null,
      band: t.protein,
      okBand: { min: okFloor, max: t.protein.max },
      values: a.days.map(d => ({ key: d.key, value: d.protein, log: d.protein === null && d.log !== 'none' ? 'none' : d.log })),
      judge: v => (v >= t.proteinFloor ? 'met' : v >= okFloor ? 'ok' : 'below'),
      format: v => formatGrams(v),
      verdictText: { met: `on target (${t.proteinFloor} g or more)`, ok: 'OK, close to the floor', above: 'on target', below: `under ${okFloor} g` },
      offLabel: `under ${okFloor} g`,
    });
  }
  if (measures.length === 0) return null;

  return (
    <section>
      <SectionTitle hint={`last ${TREND_DAYS} days · ${formatDayKeyLong(a.from)} – ${formatDayKeyLong(a.to)}`}>Eating to your targets</SectionTitle>
      <div className={`grid grid-cols-1 gap-4 ${measures.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {measures.map(m => (
          <MeasureCard key={m.title} m={m} />
        ))}
      </div>
    </section>
  );
}

function MeasureCard({ m }: { m: Measure }) {
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text-primary">{m.title}</h3>
          <p className="text-xs text-text-secondary tnum">Target {m.target}</p>
          <p className="text-xs text-text-secondary tnum">OK {m.okTarget}</p>
        </div>
        <Ring met={m.met} ok={m.ok} of={m.of} />
      </div>
      <p className="mt-3 text-sm text-text-primary">
        <span className="text-2xl font-semibold tnum">{m.met + m.ok}</span>
        <span className="text-text-secondary tnum"> of {m.of} logged days</span> {m.okLabel}
      </p>
      <p className="mt-0.5 text-xs text-text-secondary tnum">
        {m.met} on target · average {m.average}
        {m.breakdown ? ` · ${m.breakdown}` : ''}
      </p>
      <div className="mt-4">
        <DayDots m={m} />
      </div>
    </Card>
  );
}

/**
 * The share of logged days within the OK range, as a ring: the days on target
 * first in the full colour, then the rest of the OK days in a lighter one.
 */
function Ring({ met, ok, of }: { met: number; ok: number; of: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const metShare = of > 0 ? met / of : 0;
  const share = of > 0 ? (met + ok) / of : 0;
  const pct = Math.round(share * 100);
  const arc = (from: number, to: number, color: string) =>
    to > from && (
      <circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={`${c * (to - from)} ${c}`}
        transform={`rotate(${-90 + from * 360} 22 22)`}
      />
    );
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 44 44"
      className="shrink-0"
      role="img"
      aria-label={`${pct} % of logged days within the OK range, ${Math.round(metShare * 100)} % on target`}
    >
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--color-surface-muted)" strokeWidth={5} />
      {arc(metShare, share, 'color-mix(in srgb, var(--color-category-nutrition) 50%, transparent)')}
      {arc(0, metShare, MET)}
      <text x={22} y={22} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="var(--color-text-primary)">
        {pct}%
      </text>
    </svg>
  );
}

const PLOT = 112;
const DOT = 8;
/** The least room between two scale labels, px. */
const LABEL_GAP = 11;

/** Each day of the window as a dot against the target range; gaps where nothing was logged. */
function DayDots({ m }: { m: Measure }) {
  // The scale follows the counted days: a partial log far below them would
  // flatten the range, so it is pinned to the edge instead.
  const counted = m.values.filter(v => v.log === 'complete' && v.value !== null).map(v => v.value!);
  const min = Math.min(m.okBand.min, ...counted);
  const max = Math.max(m.okBand.max, ...counted);
  const pad = Math.max((max - min) * 0.12, m.okBand.max * 0.03);
  const lo = min - pad;
  const hi = max + pad;
  const y = (v: number) => Math.min(PLOT, Math.max(0, ((hi - v) / (hi - lo)) * PLOT));
  const n = m.values.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const tick = (v: number) => Math.round(v).toLocaleString('en-US');
  const unlogged = m.values.filter(v => v.value === null).length;
  const summary = `${m.title}, ${m.met + m.ok} of ${m.of} logged days ${m.okLabel} and ${m.met} on target; target ${m.target}, OK ${m.okTarget}; ${unlogged} of ${n} days without a log.`;
  // The target's edges first, then the OK range's, each left out where it would overlap one already placed.
  const labels: { v: number; top: number }[] = [];
  for (const v of [m.band.max, m.band.min, m.okBand.max, m.okBand.min]) {
    const top = y(v);
    if (labels.some(l => l.v === v || Math.abs(l.top - top) < LABEL_GAP)) continue;
    labels.push({ v, top });
  }

  return (
    <figure className="m-0">
      <div className="flex" role="img" aria-label={summary}>
        <div className="relative w-10 shrink-0" style={{ height: PLOT + 14 }} aria-hidden="true">
          {labels.map(l => (
            <span key={l.v} className="absolute right-2 -translate-y-1/2 text-[10px] leading-none text-text-secondary tnum" style={{ top: l.top }}>
              {tick(l.v)}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0" style={{ height: PLOT + 14 }} aria-hidden="true">
          <div
            className="absolute inset-x-0 rounded-sm"
            style={{ top: y(m.okBand.max), height: Math.max(2, y(m.okBand.min) - y(m.okBand.max)), background: MET, opacity: 0.08 }}
          />
          <div
            className="absolute inset-x-0 rounded-sm"
            style={{ top: y(m.band.max), height: Math.max(2, y(m.band.min) - y(m.band.max)), background: MET, opacity: 0.2 }}
          />
          {m.values.map((d, i) => {
            if (d.value === null) {
              return (
                <span
                  key={d.key}
                  className="absolute rounded-full bg-border-strong"
                  style={{ left: `calc(${x(i)}% - 1px)`, top: PLOT + 6, width: 2, height: 6, opacity: 0.6 }}
                  title={`${formatDayKeyLong(d.key)}: not logged`}
                />
              );
            }
            const verdict = m.judge(d.value);
            const partial = d.log === 'partial';
            return (
              <span
                key={d.key}
                className="absolute rounded-full"
                style={{
                  left: `calc(${x(i)}% - ${DOT / 2}px)`,
                  top: y(d.value) - DOT / 2,
                  width: DOT,
                  height: DOT,
                  background: partial ? 'var(--color-surface)' : verdict === 'met' ? MET : verdict === 'ok' ? OK : OFF,
                  border: partial ? '1.5px solid var(--color-text-secondary)' : verdict === 'ok' ? `1.5px solid ${MET}` : 'none',
                }}
                title={`${formatDayKeyLong(d.key)}: ${m.format(d.value)} — ${partial ? 'partial log, not counted' : m.verdictText[verdict]}`}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-1 ml-10 flex justify-between text-[10px] text-text-secondary tnum" aria-hidden="true">
        <span>{formatDayKeyShort(m.values[0].key)}</span>
        <span>{formatDayKeyShort(m.values[n - 1].key)}</span>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
        <span><Swatch color={MET} />on target</span>
        <span><Swatch color={OK} ring={MET} />OK</span>
        <span><Swatch color={OFF} />{m.offLabel}</span>
        {m.values.some(v => v.log === 'partial' && v.value !== null) && <span><Swatch hollow />partial log, not counted</span>}
        {unlogged > 0 && (
          <span>
            <span aria-hidden="true" className="inline-block w-0.5 h-1.5 rounded-full bg-border-strong mr-1.5 align-middle" />
            not logged
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function Swatch({ color, ring, hollow = false }: { color?: string; ring?: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
      style={hollow ? { border: '1.5px solid var(--color-text-secondary)' } : { background: color, border: ring ? `1.5px solid ${ring}` : undefined }}
    />
  );
}
