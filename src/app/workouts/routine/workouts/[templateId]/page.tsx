// ── /workouts/routine/workouts/[templateId] ─────────────
//
// One session template of the active training plan ("Workout A"). useParams
// needs a Suspense boundary, so the view sits inside one.

import { Suspense } from 'react';
import { RoutineWorkoutPage } from '@/components/routine/RoutineWorkoutPage';
import { LoadingState } from '@/components/ui/primitives';

export default function RoutineWorkout() {
  return (
    <Suspense fallback={<LoadingState label="Loading the workout" />}>
      <RoutineWorkoutPage />
    </Suspense>
  );
}
