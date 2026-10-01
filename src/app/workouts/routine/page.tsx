// ── /workouts/routine ───────────────────────────────────
//
// The active training plan: its cadence, workouts, phases and calendar blocks.

import { Suspense } from 'react';
import { RoutinePlanPage } from '@/components/routine/RoutinePlanPage';
import { LoadingState } from '@/components/ui/primitives';

export default function RoutinePlan() {
  return (
    <Suspense fallback={<LoadingState label="Loading the plan" />}>
      <RoutinePlanPage />
    </Suspense>
  );
}
