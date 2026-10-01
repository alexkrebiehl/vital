// ── /workouts/recovery ──────────────────────────────────
//
// Recovery and deloads for the active training plan: why the routine's recovery
// and deload badges say what they say, the readings behind them, and what to do.
// A sibling of /workouts/all rather than under /workouts/routine, where it would
// shadow a plan path with the id "recovery".

import { Suspense } from 'react';
import { RoutineRecoveryPage } from '@/components/routine/RoutineRecoveryPage';
import { LoadingState } from '@/components/ui/primitives';

export default function RoutineRecovery() {
  return (
    <Suspense fallback={<LoadingState label="Loading recovery" />}>
      <RoutineRecoveryPage />
    </Suspense>
  );
}
