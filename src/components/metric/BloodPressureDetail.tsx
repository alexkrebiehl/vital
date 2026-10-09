'use client';

// ── /metric/blood_pressure: the detail page for a PAIR ──────────────────────
//
// Blood pressure is two numbers per reading, so nothing on this page is a single
// systolic figure labelled "blood pressure". Every card, statistic and baseline
// is computed for systolic and diastolic separately and printed as a pair
// (111/71 mmHg). Several readings on one day stay separate.

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PageHero } from '@/components/art/PageHero';
import { BloodPressureSpark } from '@/components/art/BloodPressureSpark';
import { artCategoryOf } from '@/components/domain/DomainShared';
import { getMetric, getAllMetrics } from '@/lib/metrics';
import { formatBloodPressure, formatBloodPressureChange, metricUnit } from '@/lib/metrics/format';
import { REFERENCE_KEY, bloodPressureSeries, metricHasData, unavailableReasonFor } from '@/lib/adapters/dataset';
import {
  bloodPressureBaseline, bloodPressureChange, bloodPressureInWindow, bloodPressureStats,
  diffDays, formatDayKeyLong, previousWindow, trailingWindow, windowDays, windowRangeLabel,
  type DayWindow,
} from '@/lib/analytics';
import { Card, Badge, InsufficientDataState, StaleBadge, DataStateNote } from '@/components/ui/primitives';
import { BloodPressureChart, BloodPressureDataTable } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { RangeControl } from '@/components/ui/RangeControl';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { RANGE_EXTRAS, RelatedMetricsList, SummaryCard, actualRangeWindow, isKnownRange } from './detailShared';

const EVALUATED_DAYS = 7;
const BASELINE_DAYS = 30;
const ID = 'blood_pressure';

export function BloodPressureDetail() {
  const units = useUnits().units;
  const dataMeta = useDatasetMeta();
  const meta = getMetric(ID)!;
  const requested = useSearchParams().get('range');
  const [range, setRange] = useState<string>(isKnownRange(requested) ? requested : meta.defaultRange || '30d');
  const [showBaseline, setShowBaseline] = useState(true);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const pair = (s: number, d: number) => formatBloodPressure(s, d, units);

  const all = useMemo(() => bloodPressureSeries(), []);
  const relatedMetrics = useMemo(
    () => getAllMetrics().filter(m => m.category === meta.category && m.id !== ID && (m.demoAvailable || metricHasData(m.id))),
    [meta]
  );

  if (all.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <Badge variant="default" className="text-[10px]">{meta.category}</Badge>
          <h1 className="text-2xl md:text-3xl font-semibold text-text-primary mt-2">{meta.displayName}</h1>
        </div>
        <InsufficientDataState
          metricName={meta.displayName}
          message={`${unavailableReasonFor(ID)} Nothing is substituted for it — no value, no zero, and no chart are shown.`}
        />
        <RelatedMetricsList metrics={relatedMetrics} />
      </div>
    );
  }

  const evaluatedWindow = trailingWindow(REFERENCE_KEY, EVALUATED_DAYS);
  const baselineWindow = previousWindow(evaluatedWindow, BASELINE_DAYS, `Previous ${BASELINE_DAYS}-day baseline`);
  const chartWindow: DayWindow = actualRangeWindow(range, all.map(r => ({ key: r.date })));
  const chartRecords = bloodPressureInWindow(all, chartWindow);
  const evaluated = bloodPressureInWindow(all, evaluatedWindow);
  const baselineRecords = bloodPressureInWindow(all, baselineWindow);
  const evaluatedStats = bloodPressureStats(evaluated);
  const baselineStats = bloodPressureStats(baselineRecords);
  const change = bloodPressureChange(evaluated, baselineRecords);
  const windowStats = bloodPressureStats(chartRecords);

  const latest = all[all.length - 1];
  const yesterdayKey = trailingWindow(REFERENCE_KEY, 2).startKey;
  const dayCard = (key: string, none: string) => {
    const day = all.filter(r => r.date === key);
    const last = day[day.length - 1];
    return {
      value: last ? pair(last.systolic, last.diastolic) : 'No reading',
      sub: last ? `${formatDayKeyLong(key)}${day.length > 1 ? ` · latest of ${day.length} readings` : ''}` : none,
    };
  };
  const today = dayCard(REFERENCE_KEY, 'not recorded today');
  const yesterday = dayCard(yesterdayKey, 'not recorded yesterday');
  const staleDays = diffDays(latest.date, REFERENCE_KEY);
  const noData = 'Not enough data';
  const stat = (s: typeof windowStats, pick: 'mean' | 'min' | 'max' | 'median') =>
    s ? pair(s.systolic[pick], s.diastolic[pick]) : '—';
  const toggle = (on: boolean) => (on ? 'bg-surface text-text-primary' : 'bg-surface-muted text-text-secondary');

  return (
    <div className="space-y-6">
      <PageHero
        title={meta.displayName}
        eyebrow={meta.category}
        category={artCategoryOf(ID)}
        seed={ID.length * 131 + ID.charCodeAt(0)}
        subtitle={`Systolic and diastolic, one pair per reading · unit ${metricUnit(ID, units)}`}
        aside={
          <div className="w-full max-w-[260px] rounded-2xl border border-border bg-surface/80 p-4 shadow-card backdrop-blur-sm">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">Latest reading</div>
            <div className="mt-1 text-[34px] font-semibold leading-none tnum tracking-[-0.03em] text-text-primary">
              {pair(latest.systolic, latest.diastolic)}
            </div>
            <div className="mt-1 text-[11px] text-text-secondary">{formatDayKeyLong(latest.date)}</div>
            <div className="mt-3" aria-hidden="true"><BloodPressureSpark readings={chartRecords} height={40} /></div>
          </div>
        }
      >
        {!dataMeta.live && meta.demoAvailable && <Badge variant="accent" className="text-[10px]">Demo</Badge>}
        <StaleBadge days={staleDays} />
      </PageHero>

      <div className="space-y-1.5">
        {today.value === 'No reading' && (
          <DataStateNote>No reading today — showing the latest available reading ({formatDayKeyLong(latest.date)}).</DataStateNote>
        )}
        {staleDays >= 2 && (
          <DataStateNote tone="attention">
            The most recent reading is {staleDays} days before the reference date, so this metric is not current.
          </DataStateNote>
        )}
      </div>

      <section aria-label="Comparison windows">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <SummaryCard label="Latest reading" value={pair(latest.systolic, latest.diastolic)} sub={formatDayKeyLong(latest.date)} />
          <SummaryCard label="Today" value={today.value} sub={today.sub} />
          <SummaryCard label="Yesterday" value={yesterday.value} sub={yesterday.sub} />
          <SummaryCard
            label={`${EVALUATED_DAYS}-day average`}
            value={evaluatedStats ? stat(evaluatedStats, 'mean') : noData}
            sub={`${windowRangeLabel(evaluatedWindow)} · ${evaluatedStats?.count ?? 0} readings`}
          />
          <SummaryCard
            label={`Previous ${BASELINE_DAYS}-day baseline`}
            value={baselineStats ? stat(baselineStats, 'mean') : noData}
            sub={`${windowRangeLabel(baselineWindow)} · ${baselineStats?.count ?? 0} readings`}
          />
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          Change ({EVALUATED_DAYS}-day average vs previous {BASELINE_DAYS}-day baseline):{' '}
          <strong className="font-medium tnum text-text-primary">
            {change ? formatBloodPressureChange(change.systolic, change.diastolic, units) : '—'}
          </strong>{' '}
          (systolic/diastolic)
        </p>
      </section>

      <section aria-label="Range statistics">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
          <span className="tnum">Average: {stat(windowStats, 'mean')}</span>
          <span className="tnum">Min: {stat(windowStats, 'min')}</span>
          <span className="tnum">Max: {stat(windowStats, 'max')}</span>
          <span className="tnum">Median: {stat(windowStats, 'median')}</span>
          <span className="tnum">Readings: {chartRecords.length}</span>
          <span className="tnum">Window: {windowRangeLabel(chartWindow)} ({windowDays(chartWindow)} days)</span>
        </div>
        <p className="mt-1 text-[11px] text-text-secondary">
          Each figure is computed for systolic and diastolic separately, so Min and Max may combine numbers from
          different readings.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeControl value={range} onChange={setRange} format="token" extraOptions={RANGE_EXTRAS} ariaLabel="Chart range" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBaseline(!showBaseline)}
            aria-pressed={showBaseline}
            className={`px-3 py-1.5 text-xs font-medium rounded-control transition-colors min-h-[32px] ${showBaseline ? 'bg-accent-tint text-primary' : 'bg-surface-muted text-text-secondary'}`}
          >
            Baseline band
          </button>
          <div className="flex rounded-control overflow-hidden border border-border">
            {(['chart', 'table'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-1.5 text-xs font-medium min-h-[32px] ${toggle(view === v)}`}>
                {v === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card className="p-4 md:p-6">
        {chartRecords.length === 0 ? (
          <InsufficientDataState message={`No readings fall inside ${windowRangeLabel(chartWindow)}. Widen the range to see recorded values.`} />
        ) : view === 'chart' ? (
          <BloodPressureChart
            records={chartRecords}
            baseline={bloodPressureBaseline(baselineRecords)}
            showBaseline={showBaseline}
            height={320}
            showBrush={chartRecords.length > 60}
            units={units}
          />
        ) : (
          <BloodPressureDataTable records={[...chartRecords].reverse().slice(0, 120)} units={units} />
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-2">How this range compares</h3>
        <div className="flex items-start gap-2">
          {change && change.systolic + change.diastolic > 0 ? (
            <TrendingUp size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
          ) : change && change.systolic + change.diastolic < 0 ? (
            <TrendingDown size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <Minus size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <div className="text-sm text-text-primary">
            {evaluatedStats && baselineStats && change ? (
              <>
                The {EVALUATED_DAYS}-day average is <strong className="font-medium">{stat(evaluatedStats, 'mean')}</strong>, and the
                previous {BASELINE_DAYS}-day baseline is <strong className="font-medium">{stat(baselineStats, 'mean')}</strong>.
                <span className="block text-text-secondary text-xs mt-1">
                  Difference {formatBloodPressureChange(change.systolic, change.diastolic, units)} · {evaluatedStats.count} vs{' '}
                  {baselineStats.count} readings · windows {windowRangeLabel(evaluatedWindow)} and {windowRangeLabel(baselineWindow)}.
                </span>
              </>
            ) : (
              <>Not enough readings to compare {windowRangeLabel(evaluatedWindow)} with {windowRangeLabel(baselineWindow)}.</>
            )}
          </div>
        </div>
      </Card>

      <RelatedMetricsList metrics={relatedMetrics} />
    </div>
  );
}
