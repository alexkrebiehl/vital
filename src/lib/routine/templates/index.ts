// ── Reference plans ─────────────────────────────────────
//
// Complete example plans in three disciplines. They exist to show the analyst
// (and the tests) what a full plan looks like; none is a default. The analyst is
// told to fit a plan to the user's own goal, equipment, schedule and history.

import { validatePlan, type PlanValidation } from '../validate';
import { calisthenicsTemplate } from './calisthenics';
import { enduranceTemplate } from './endurance';
import { strengthTemplate } from './strength';

export interface ReferencePlan {
  id: string;
  label: string;
  /** Words that suggest this reference in a request. */
  keywords: RegExp;
  build: (startDate: string) => unknown;
}

export const REFERENCE_PLANS: ReferencePlan[] = [
  {
    id: 'calisthenics',
    label: 'Calisthenics / bodyweight skill progression',
    keywords: /calisthenic|bodyweight|body weight|push-?up|pull-?up|pistol|handstand/i,
    build: calisthenicsTemplate,
  },
  {
    id: 'strength',
    label: 'Barbell strength block',
    keywords: /strength|barbell|powerlift|squat|bench|deadlift|lifting|1rm/i,
    build: strengthTemplate,
  },
  {
    id: 'endurance-10k',
    label: '10k running build',
    keywords: /run|10k|5k|half marathon|marathon|endurance|jog/i,
    build: enduranceTemplate,
  },
];

export function referencePlan(id: string, startDate: string): PlanValidation {
  const ref = REFERENCE_PLANS.find(r => r.id === id);
  if (!ref) return { ok: false, errors: [`No reference plan "${id}" (known: ${REFERENCE_PLANS.map(r => r.id).join(', ')}).`] };
  return validatePlan(ref.build(startDate));
}
