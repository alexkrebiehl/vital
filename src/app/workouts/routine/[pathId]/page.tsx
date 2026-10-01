// ── /workouts/routine/[pathId] ──────────────────────────
//
// One progression path of the active training plan. useParams needs a Suspense
// boundary, so the detail view sits inside one.

import { Suspense } from 'react';
import { RoutinePathPage } from '@/components/routine/RoutinePathPage';
import { LoadingState } from '@/components/ui/primitives';

export default function RoutinePath() {
  return (
    <Suspense fallback={<LoadingState label="Loading the progression detail" />}>
      <RoutinePathPage />
    </Suspense>
  );
}
