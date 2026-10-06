'use client';

import { formatMetricWithUnit } from '@/lib/metrics/format';
import { REFERENCE_KEY, seriesFor } from '@/lib/adapters/dataset';
import { buildSeriesSummary, diffDays, mean, trailingWindow } from '@/lib/analytics';
import { Card } from '@/components/ui/primitives';
import { BodyMap } from '@/components/art/BodyMap';
import { HeroFigure } from '@/components/art/HeroFigure';
import { CompositionBar } from '@/components/art/CompositionBar';
import { useUnits } from '@/components/ui/UnitsProvider';
import { BodyGoalCard, BodyGoalSections } from '@/components/body-goal/BodyGoalPanel';
import { WeightTrajectory } from '@/components/body-goal/WeightTrajectory';
import { useBodyGoal, useBodyReading, useGoalReport } from '@/components/body-goal/useBodyGoal';
import {
  DomainHeader, SectionTitle, SeriesCard, MetricGrid, metricsForCategories,
} from './DomainShared';

const DAYS = 90;
const WINDOW_DAYS = 30;

export function BodyPage() {
  const { units } = useUnits();
  const win = trailingWindow(REFERENCE_KEY, DAYS);
  const inWindow = seriesFor('weight_body_mass').filter(p => p.key >= win.startKey && p.key <= win.endKey);
  const weightSummary = buildSeriesSummary('weight_body_mass', REFERENCE_KEY, WINDOW_DAYS, units);
  const gaps = inWindow.slice(1).map((p, i) => diffDays(inWindow[i].key, p.key));
  const avgGap = gaps.length ? mean(gaps) : NaN;
  const bodyComposition = metricsForCategories(['body'], ['weight_body_mass']);

  // One read of the goal for the page, shared by the goal card, the weight
  // trajectory (goal line and projection) and the goal sections.
  const goal = useBodyGoal();
  const report = useGoalReport(goal.active);
  const reading = useBodyReading();

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Body"
        category="body"
        aside={<HeroFigure metricId="weight_body_mass" category="body" days={DAYS} />}
        subtitle={`Weight and body composition, read against your goal. Measurements are individual weigh-ins, not daily readings — the average gap is ${Number.isFinite(avgGap) ? avgGap.toFixed(1) : '—'} days.`}
      />

      <BodyGoalCard goal={goal} report={report} />
      <WeightTrajectory report={report} />
      <BodyGoalSections reading={reading} report={report} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <BodyMap
        title="Where your measurements sit"
        note="The latest reading for each body measurement in your data. Only measurements that exist are shown."
        spots={[
          { metricId: 'weight_body_mass', anchor: 'torso', category: 'body' },
          { metricId: 'body_mass_index', anchor: 'body', category: 'body' },
          { metricId: 'body_fat_percentage', anchor: 'torso', category: 'nutrition' },
          { metricId: 'lean_body_mass', anchor: 'legs', category: 'activity' },
          { metricId: 'waist_circumference', anchor: 'waist', category: 'recovery' },
        ]}
      />
      <Card className="p-6 self-start">
        <h2 className="text-[18px] font-semibold text-text-primary">Composition</h2>
        <p className="mb-5 mt-1 text-sm text-text-secondary">Weight, split by the latest body-fat reading.</p>
        <CompositionBar />
      </Card>
      </div>

      {/* ── Recent comparison (only when the window has weigh-ins) ── */}
      {weightSummary.points.length > 0 && (
        <section>
          <SectionTitle hint={`last ${WINDOW_DAYS} days vs the ${WINDOW_DAYS} before`}>
            Recent change
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SeriesCard summary={weightSummary} days={WINDOW_DAYS} emphasis />
            <Card className="p-5">
              <p className="text-sm font-medium text-text-primary mb-2">How the comparison is built</p>
              <p className="text-xs text-text-secondary leading-relaxed">
                The recent figure is the average of the weigh-ins recorded in the last {WINDOW_DAYS}{' '}
                days; the baseline is the average of the weigh-ins in the {WINDOW_DAYS} days before
                that. Days without a weigh-in are excluded rather than carried forward, and no
                day-over-day change is shown for this metric.
              </p>
              <p className="text-xs text-text-secondary leading-relaxed mt-2">
                {weightSummary.valid
                  ? `Recent average ${formatMetricWithUnit('weight_body_mass', weightSummary.windowAverage, units)} from ${weightSummary.counts.evaluated} weigh-ins, baseline ${formatMetricWithUnit('weight_body_mass', weightSummary.baselineAverage, units)} from ${weightSummary.counts.baseline} weigh-ins.`
                  : 'There are not enough weigh-ins on both sides of the window to compare them.'}
              </p>
              <p className="text-[11px] text-text-secondary mt-3">
                Measurements are recorded on individual dates, so no value is shown for days without a
                weigh-in.
              </p>
            </Card>
          </div>
        </section>
      )}

      {/* ── Body composition ──────────────────────── */}
      {bodyComposition.length > 0 ? (
        <MetricGrid
          metrics={bodyComposition}
          title="Body composition"
          hint="Shown only when the dataset contains the measurement"
          days={DAYS}
        />
      ) : null}

    </div>
  );
}
