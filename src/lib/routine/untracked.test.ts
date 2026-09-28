import { describe, expect, it } from 'vitest';
import type { TrainingSession, TrainingSet } from '../workout-sources/types';
import { untrackedExercises } from './untracked';
import { validatePlan } from './validate';
import type { TrainingPlan } from './types';

const dayOf = (iso: string) => iso.slice(0, 10);

function session(date: string, exercises: { name: string; templateId?: string; warmupOnly?: boolean }[]): TrainingSession {
  return {
    id: `s:${date}`,
    sourceId: 'test',
    title: 'Session',
    startTime: `${date}T18:00:00.000Z`,
    endTime: `${date}T18:30:00.000Z`,
    exercises: exercises.map(e => ({
      sourceTemplateId: e.templateId ?? null,
      name: e.name,
      loadMeaning: 'added',
      sets: [{ index: 0, kind: (e.warmupOnly ? 'warmup' : 'normal') as TrainingSet['kind'], reps: 10 }],
    })),
  };
}

function plan(): TrainingPlan {
  const v = validatePlan({
    title: 'Plan',
    goal: 'Test',
    startDate: '2026-07-01',
    durationWeeks: 12,
    focusAreas: [
      {
        name: 'Pull',
        paths: [
          {
            id: 'row',
            name: 'Row',
            stages: [
              { name: 'Incline row', match: { names: ['Incline Row'] } },
              { name: 'Ring row', match: { names: ['Ring Row'], templateIds: ['RING'] } },
            ],
          },
        ],
      },
    ],
    templates: [{ id: 'all', name: 'All', slots: [{ pathIds: ['row'] }] }],
    schedule: { kind: 'cycle', days: ['all', 'rest'] },
  });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.plan;
}

describe('untrackedExercises', () => {
  it('lists recent exercises no stage recognises, most logged first', () => {
    const sessions = [
      session('2026-08-21', [{ name: 'Bent Over Row (Band)', templateId: 'EA820646' }, { name: 'Incline Row' }]),
      session('2026-08-25', [{ name: 'Bent Over Row (Band)', templateId: 'EA820646' }, { name: 'Face Pull' }]),
      session('2026-08-28', [{ name: 'Bent Over Row (Band)', templateId: 'EA820646' }]),
    ];
    expect(untrackedExercises(plan(), sessions, dayOf, '2026-09-27')).toEqual([
      { name: 'Bent Over Row (Band)', templateId: 'EA820646', sessions: 3, lastDate: '2026-08-28' },
      { name: 'Face Pull', templateId: null, sessions: 1, lastDate: '2026-08-25' },
    ]);
  });

  it('treats a template-id or normalised-name match as tracked', () => {
    const sessions = [session('2026-09-20', [{ name: 'Rings Row (renamed)', templateId: 'RING' }, { name: 'incline rows' }])];
    expect(untrackedExercises(plan(), sessions, dayOf, '2026-09-27')).toEqual([]);
  });

  it('ignores warm-up-only entries and sessions outside the window', () => {
    const sessions = [
      session('2026-05-01', [{ name: 'Face Pull' }]),
      session('2026-09-20', [{ name: 'Wrist Circles', warmupOnly: true }]),
    ];
    expect(untrackedExercises(plan(), sessions, dayOf, '2026-09-27')).toEqual([]);
  });
});
