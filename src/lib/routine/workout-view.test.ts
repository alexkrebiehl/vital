import { describe, expect, it } from 'vitest';
import type { TrainingSession, TrainingSet } from '../workout-sources/types';
import { buildRoutine } from './progress';
import type { NextSessionView, ScheduledDayView } from './schedule';
import { workoutDetailFrom } from './service';
import { validatePlan } from './validate';
import { workoutWhen } from './workout-view';
import type { TrainingPlan } from './types';

// ── Builders ────────────────────────────────────────────

const dayOf = (iso: string) => iso.slice(0, 10);

function session(date: string, exercises: { name: string; sets: Partial<TrainingSet>[] }[]): TrainingSession {
  return {
    id: `s:${date}:${exercises.map(e => e.name).join('+')}`,
    sourceId: 'test',
    title: 'Session',
    startTime: `${date}T18:00:00.000Z`,
    endTime: `${date}T18:30:00.000Z`,
    exercises: exercises.map(e => ({
      sourceTemplateId: null,
      name: e.name,
      loadMeaning: 'added',
      sets: e.sets.map((s, i) => ({ index: i, kind: 'normal', ...s })),
    })),
  };
}

const reps = (list: number[], rpe: number[]): Partial<TrainingSet>[] => list.map((r, i) => ({ reps: r, rpe: rpe[i] }));

const RIR = { rpe: [7, 9], rir: [1, 3] };

function plan(pushExtra: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): TrainingPlan {
  const v = validatePlan({
    title: 'Test plan',
    goal: 'Test',
    startDate: '2026-08-01',
    durationWeeks: 12,
    focusAreas: [
      {
        id: 'push-area',
        name: 'Push',
        paths: [
          {
            id: 'push',
            name: 'Horizontal push',
            currentStageId: 'decline',
            history: [{ stageId: 'decline', startedOn: '2026-09-08' }],
            stages: [
              { id: 'floor', name: 'Floor push-up', match: { names: ['Push Up'] }, advanceWhen: { sets: [3, 4], reps: [10, 15], effort: RIR } },
              { id: 'decline', name: 'Decline push-up', match: { names: ['Decline Push Up'] }, advanceWhen: { sets: [3, 4], reps: [8, 12], effort: RIR } },
              { id: 'close-grip', name: 'Close-grip push-up', match: { names: ['Diamond Push Up'] }, prescription: { sets: [3, 3], reps: [8, 12] } },
            ],
            ...pushExtra,
          },
        ],
      },
      {
        id: 'pull-area',
        name: 'Pull',
        paths: [
          {
            id: 'pull-up',
            name: 'Pull-up',
            currentStageId: 'negatives',
            currentStepIndex: 0,
            history: [{ stageId: 'negatives', stepIndex: 0, startedOn: '2026-09-01' }],
            stages: [
              {
                id: 'negatives',
                name: 'Negative pull-up',
                match: { names: ['Negative Pull Up'] },
                advanceWhen: { sets: [3, 3], reps: [5, 5] },
                steps: [
                  { name: '1×3', advanceWhen: { sets: [1, 1], reps: [3, 3], effort: RIR } },
                  { name: '3×3', advanceWhen: { sets: [3, 3], reps: [3, 3], effort: RIR } },
                ],
              },
              { id: 'pull-up', name: 'Pull-up', match: { names: ['Pull Up'] }, prescription: { sets: [3, 3], reps: [3, 5] } },
            ],
          },
          {
            id: 'row',
            name: 'Row',
            stages: [{ id: 'band-row', name: 'Band row', match: { names: ['Band Row'] }, advanceWhen: { sets: [3, 3], reps: [10, 15], effort: RIR } }],
          },
        ],
      },
    ],
    rules: { qualifyingSessions: [2, 3], effort: RIR },
    templates: [
      { id: 'a', name: 'Workout A', minutes: 30, warmup: ['Arm circles'], slots: [{ pathIds: ['push'] }, { pathIds: ['pull-up', 'row'], rotate: true, note: 'Alternate.' }] },
      { id: 'b', name: 'Workout B', slots: [{ pathIds: ['row'] }] },
    ],
    schedule: { kind: 'cycle', days: ['a', 'b', 'rest'], advance: 'on-completion' },
    ...extra,
  });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.plan;
}

function run(p: TrainingPlan, sessions: TrainingSession[], today: string) {
  return buildRoutine({
    stored: { id: 'plan-test', status: 'active', plan: p, revision: 1, createdAt: '', updatedAt: '' },
    sessions,
    workouts: [],
    series: () => [],
    today,
    dayOf,
    system: 'metric',
  });
}

// Decline push-ups at the top of the range but with high effort: yellow-green.
const NEARLY = [
  session('2026-09-11', [{ name: 'Decline Push Up', sets: reps([12, 10, 8], [8, 9, 9.5]) }]),
  session('2026-09-15', [{ name: 'Decline Push Up', sets: reps([12, 11, 9], [8.5, 9, 9.5]) }]),
  session('2026-09-18', [{ name: 'Decline Push Up', sets: reps([12, 12, 10], [8.5, 9, 9.5]) }]),
];
// Two more at the marker and target effort: green.
const READY = [
  ...NEARLY,
  session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
  session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
];

const workout = (routine: ReturnType<typeof run>, id: string) => routine.workouts.find(w => w.id === id)!;
const slot = (routine: ReturnType<typeof run>, templateId: string, pathId: string) =>
  workout(routine, templateId).domains.flatMap(d => d.slots).find(s => s.pathId === pathId);

// ── Structure ───────────────────────────────────────────

describe('workout views', () => {
  it('builds one view per template, grouping its slots by domain', () => {
    const routine = run(plan(), NEARLY, '2026-09-18');
    expect(routine.workouts.map(w => w.id)).toEqual(['a', 'b']);
    const a = workout(routine, 'a');
    expect(a).toMatchObject({ name: 'Workout A', minutes: 30, warmup: ['Arm circles'], timesDone: 3, lastDone: '2026-09-18' });
    expect(a.domains.map(d => d.areaName)).toEqual(['Push', 'Pull']);
    expect(a.domains[0].slots[0]).toMatchObject({ stageName: 'Decline push-up', dose: '3–4 × 8–12 RPE 7–9' });
  });

  it('resolves a rotating slot to one path and names the others', () => {
    const routine = run(plan(), NEARLY, '2026-09-18');
    // Three Workout A sessions logged: the rotation [pull-up, row] is on row.
    const rotating = workout(routine, 'a').domains[1].slots[0];
    expect(rotating.pathId).toBe('row');
    expect(rotating.rotatesWith).toEqual(['Pull-up']);
    expect(rotating.note).toBe('Alternate.');
  });

  it('names what comes next on a path whatever the light', () => {
    const routine = run(plan(), [], '2026-09-18');
    expect(slot(routine, 'a', 'push')).toMatchObject({ light: 'none', nextName: 'Close-grip push-up', suggestion: null });
  });
});

// ── Suggestions ─────────────────────────────────────────

describe('next suggestions', () => {
  it('suggests the next stage as "nearly" at yellow-green', () => {
    const s = slot(run(plan(), NEARLY, '2026-09-18'), 'a', 'push')!;
    expect(s.light).toBe('yellow-green');
    expect(s.suggestion).toMatchObject({ kind: 'stage', name: 'Close-grip push-up', status: 'nearly' });
    expect(s.suggestion!.text).toBe('Nearly there: Close-grip push-up is next once this turns green.');
  });

  it('suggests moving on, with the next stage\'s dose, at green', () => {
    const s = slot(run(plan(), READY, '2026-09-25'), 'a', 'push')!;
    expect(s.light).toBe('green');
    expect(s.suggestion).toMatchObject({ kind: 'stage', name: 'Close-grip push-up', dose: '3 × 8–12', status: 'ready' });
    expect(s.suggestion!.text).toBe('Ready: move to Close-grip push-up (3 × 8–12).');
  });

  it('defers a ready suggestion until a running deload is over', () => {
    const p = plan({}, { blocks: [{ id: 'deload', name: 'Deload week', kind: 'deload', startWeek: 8, weeks: 2 }] });
    const s = slot(run(p, READY, '2026-09-25'), 'a', 'push')!;
    expect(s.suggestion?.text).toBe('Ready for Close-grip push-up once the deload is done.');
  });

  it('suggests nothing below yellow-green or while on hold', () => {
    const early = slot(run(plan(), NEARLY.slice(0, 1), '2026-09-11'), 'a', 'push')!;
    expect(['yellow', 'red', 'none']).toContain(early.light);
    expect(early.suggestion).toBeNull();
    const held = slot(run(plan({ hold: { kind: 'hold', reason: 'sore shoulder', since: '2026-09-17' } }), READY, '2026-09-25'), 'a', 'push')!;
    expect(held.onHold).toBe(true);
    expect(held.suggestion).toBeNull();
    expect(held.topOfPath).toBe(false);
  });

  it('suggests the next step before the next stage', () => {
    const negatives = [
      session('2026-09-10', [{ name: 'Negative Pull Up', sets: reps([3], [8]) }]),
      session('2026-09-14', [{ name: 'Negative Pull Up', sets: reps([3], [8]) }]),
    ];
    const routine = run(plan(), negatives, '2026-09-14');
    const pull = routine.paths.find(p => p.pathId === 'pull-up')!;
    expect(pull.light).toBe('green');
    const s = routine.workouts.flatMap(w => w.domains.flatMap(d => d.slots)).find(x => x.pathId === 'pull-up')!;
    expect(s).toMatchObject({ stageName: 'Negative pull-up', stepName: '1×3', nextName: '3×3' });
    expect(s.suggestion).toMatchObject({ kind: 'step', name: '3×3', status: 'ready' });
    expect(s.suggestion!.text).toMatch(/^Ready: move to the next step, 3×3/);
  });

  it('marks the top of a single-stage path instead of suggesting', () => {
    const rows = [
      session('2026-09-10', [{ name: 'Band Row', sets: reps([15, 15, 15], [8, 8, 8]) }]),
      session('2026-09-14', [{ name: 'Band Row', sets: reps([15, 15, 15], [8, 8, 8]) }]),
    ];
    const s = slot(run(plan(), rows, '2026-09-14'), 'b', 'row')!;
    expect(s.light).toBe('green');
    expect(s).toMatchObject({ suggestion: null, topOfPath: true, nextName: null });
  });
});

// ── When ────────────────────────────────────────────────

const train = (id: string, name: string, label = name): ScheduledDayView => ({ kind: 'train', label, templates: [{ id, name, warmup: [], slots: [] }] });
const rest: ScheduledDayView = { kind: 'rest', label: 'Rest day', templates: [] };
const nextView = (due: ScheduledDayView, upcoming: ScheduledDayView[], extra: Partial<NextSessionView> = {}): NextSessionView => ({
  scheduleKind: 'cycle',
  due,
  doneToday: false,
  why: '',
  upcoming,
  ...extra,
});
const A = train('a', 'Workout A');
const B = train('b', 'Workout B');

describe('workoutWhen', () => {
  it('reads today, next and later in cycle terms', () => {
    expect(workoutWhen(nextView(A, [B, rest, A]), 'a')).toBe('Due today');
    expect(workoutWhen(nextView(A, [B, rest, A], { doneToday: true }), 'a')).toBe('Next up');
    expect(workoutWhen(nextView(rest, [A, B, rest]), 'a')).toBe("Next, after today's rest");
    expect(workoutWhen(nextView(rest, [A, B, rest]), 'b')).toBe('After Workout A');
    expect(workoutWhen(nextView(A, [B, rest, A]), 'b')).toBe('After Workout A');
    expect(workoutWhen(nextView(B, [rest, A, B], { doneToday: true }), 'a')).toBe('After a rest day');
  });

  it('names the weekday for a weekday schedule', () => {
    const next = nextView(rest, [train('u', 'Upper', 'Mon: Upper'), train('l', 'Lower', 'Wed: Lower')], { scheduleKind: 'weekdays' });
    expect(workoutWhen(next, 'l')).toBe('Next on Wed');
  });

  it('is null when the template is not coming up soon', () => {
    expect(workoutWhen(nextView(A, [rest, A, rest]), 'b')).toBeNull();
  });
});

describe('workoutDetailFrom', () => {
  it('finds a template by id, or nothing', () => {
    const routine = run(plan(), NEARLY, '2026-09-18');
    expect(workoutDetailFrom(routine, 'b')?.workout.name).toBe('Workout B');
    expect(workoutDetailFrom(routine, 'nope')).toBeNull();
  });
});
