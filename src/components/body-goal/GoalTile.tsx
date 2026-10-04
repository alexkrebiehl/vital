'use client';

// ── Overview: the body goal at a glance ─────────────────
//
// Phase, progress, the four-week trend against the recommended pace, and the
// projected arrival, linking to Body. Hidden when no goal is set (or it cannot
// be read): the Overview never shows an empty goal shell.

import Link from 'next/link';
import { ChevronRight, Target } from 'lucide-react';
import { Badge, Card } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { PHASE_LABEL } from '@/lib/body-goal/phase';
import { FIT_TEXT, formatKcal, formatKg, formatPct, formatRange, formatRate } from './format';
import { useBodyGoal, useGoalReport } from './useBodyGoal';

export function GoalTile() {
  const { units } = useUnits();
  const { active } = useBodyGoal();
  const report = useGoalReport(active);
  if (!active || !report) return null;
  const { phase, weight, projection, targets } = report;
  const title = active.kind === 'weight' ? formatKg(active.target, units) : `${formatPct(active.target)} body fat`;

  return (
    <Card className="p-5 md:p-6" as="section" aria-label="Your body goal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <Target size={14} aria-hidden="true" />
            Your goal
            {phase.phase && <Badge variant="accent">{PHASE_LABEL[phase.phase]}</Badge>}
          </div>
          <p className="mt-1 text-[22px] font-semibold tnum text-text-primary">{title}</p>
        </div>
        <Link href="/body" className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
          Open Body <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {phase.reason ? (
        <p className="mt-2 text-sm text-text-secondary">{phase.reason}</p>
      ) : (
        <>
          {report.progress !== null && (
            <div className="mt-3 h-2 rounded-full bg-surface-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(report.progress * 100)} aria-label="Progress toward the goal">
              <div className="h-full rounded-full bg-category-body" style={{ width: `${Math.max(2, report.progress * 100)}%` }} />
            </div>
          )}
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-text-secondary">Trend, four weeks</dt>
              <dd className="tnum text-text-primary">{weight.rateKgPerWeek !== null ? formatRate(weight.rateKgPerWeek, units) : '—'}</dd>
              <dd className="text-[11px] text-text-secondary">{FIT_TEXT[report.fit]}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">{phase.phase === 'maintain' ? 'Status' : 'Projected arrival'}</dt>
              <dd className="tnum text-text-primary">
                {phase.phase === 'maintain' ? 'At the goal' : projection?.chosen ? formatDayKeyLong(projection.chosen.arrival) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Calories to aim for</dt>
              <dd className="tnum text-text-primary">{targets?.calories ? formatRange(targets.calories, 'kcal') : '—'}</dd>
              {report.energy.maintenance !== null && <dd className="text-[11px] text-text-secondary">maintenance ≈ {formatKcal(report.energy.maintenance)}</dd>}
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}
