import { describe, expect, it } from 'vitest';
import type { WorkoutRecord } from '../metrics/types';
import type { TrainingSession, TrainingSet } from '../workout-sources/types';
import { buildRoutine, inferCurrentStages, type RoutineInputs } from './progress';
import { deloadStatus, planWeek } from './position';
import { adherence, completedSessions, nextSession } from './schedule';
import { validatePlan } from './validate';
import type { TrainingPlan } from './types';

// ── Builders ────────────────────────────────────────────

const dayOf = (iso: string) => iso.slice(0, 10);

function session(date: string, exercises: { name: string; sets: Partial<TrainingSet>[]; assisted?: boolean; notes?: string }[]): TrainingSession {
  return {
    id: `s:${date}:${exercises.map(e => e.name).join('+')}`,
    sourceId: 'test',
    title: 'Session',
    startTime: `${date}T18:00:00.000Z`,
    endTime: `${date}T18:30:00.000Z`,
    exercises: exercises.map(e => ({
      sourceTemplateId: null,
      name: e.name,
      loadMeaning: e.assisted ? 'assistance' : 'added',
      sets: e.sets.map((s, i) => ({ index: i, kind: 'normal', ...s })),
      ...(e.notes ? { notes: e.notes } : {}),
    })),
  };
}

const reps = (list: number[], rpe?: number[], weightKg?: number): Partial<TrainingSet>[] =>
  list.map((r, i) => ({ reps: r, ...(rpe ? { rpe: rpe[i] } : {}), ...(weightKg !== undefined ? { weightKg } : {}) }));

function plan(input: Record<string, unknown>): TrainingPlan {
  const v = validatePlan({
    title: 'Test plan',
    goal: 'Test',
    startDate: '2026-08-01',
    durationWeeks: 12,
    templates: [{ id: 'all', name: 'All', slots: [{ pathIds: ['push'] }] }],
    schedule: { kind: 'cycle', days: ['all', 'rest'] },
    ...input,
  });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.plan;
}

function run(p: TrainingPlan, sessions: TrainingSession[], today: string, extra: Partial<RoutineInputs> = {}) {
  return buildRoutine({
    stored: { id: 'plan-test', status: 'active', plan: p, revision: 1, createdAt: '', updatedAt: '' },
    sessions,
    workouts: [],
    series: () => [],
    today,
    dayOf,
    system: 'metric',
    ...extra,
  });
}

// The push-up progression from the routine design: floor push-ups at 3–4 × 10–15,
// then decline push-ups at 3–4 × 8–12, working at 1–3 reps in reserve (RPE 7–9).
const RIR = { rpe: [7, 9], rir: [1, 3] };
function pushPlan(extra: Record<string, unknown> = {}, pathExtra: Record<string, unknown> = {}) {
  return plan({
    focusAreas: [
      {
        id: 'upper',
        name: 'Push',
        paths: [
          {
            id: 'push',
            name: 'Horizontal push',
            currentStageId: 'decline',
            history: [
              { stageId: 'floor', startedOn: '2026-08-01' },
              { stageId: 'decline', startedOn: '2026-09-08' },
            ],
            stages: [
              { id: 'floor', name: 'Floor push-up', match: { names: ['Push Up'] }, advanceWhen: { sets: [3, 4], reps: [10, 15], effort: RIR } },
              { id: 'decline', name: 'Decline push-up', match: { names: ['Decline Push Up'] }, advanceWhen: { sets: [3, 4], reps: [8, 12], effort: RIR } },
              { id: 'close-grip', name: 'Close-grip push-up', match: { names: ['Diamond Push Up'] }, prescription: { sets: [3, 3], reps: [8, 12] } },
            ],
            ...pathExtra,
          },
        ],
      },
    ],
    rules: { qualifyingSessions: [2, 3], effort: RIR },
    ...extra,
  });
}

const EXAMPLE = [
  session('2026-08-25', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-08-28', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-09-04', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-09-08', [{ name: 'Decline Push Up', sets: reps([8, 8, 8], [7.5, 8, 8.5]) }]),
  session('2026-09-11', [{ name: 'Decline Push Up', sets: reps([12, 10, 8], [8, 9, 9.5]) }]),
  session('2026-09-15', [{ name: 'Decline Push Up', sets: reps([12, 11, 9], [8.5, 9, 9.5]) }]),
  session('2026-09-18', [{ name: 'Decline Push Up', sets: reps([12, 12, 10], [8.5, 9, 9.5]) }]),
];

// ── The worked example ──────────────────────────────────

describe('variation model on the decline push-up example', () => {
  const routine = run(pushPlan(), EXAMPLE, '2026-09-18');
  const push = routine.paths[0];

  it('reproduces the session table', () => {
    expect(push.rows.map(r => [r.dates.join(' / '), r.work, r.headline])).toEqual([
      ['2026-08-25 / 2026-08-28', 'Floor push-up 15/12/9', '36 reps'],
      ['2026-09-04', 'Floor push-up 15/12/9', '36 reps'],
      ['2026-09-08', 'Decline push-up 8/8/8', '24 reps'],
      ['2026-09-11', 'Decline push-up 12/10/8', '30 reps'],
      ['2026-09-15', 'Decline push-up 12/11/9', '32 reps'],
      ['2026-09-18', 'Decline push-up 12/12/10', '34 reps'],
    ]);
    expect(push.rows.map(r => r.signal).slice(1)).toEqual([
      'Final floor push-up session before progression',
      'Clean decline push-up entry',
      'Rapid volume increase',
      'New best',
      'Near top of range, effort high',
    ]);
  });

  it('lights yellow-green: reps meet the range, effort above the ceiling', () => {
    expect(push.light).toBe('yellow-green');
    expect(push.reasons[0]).toContain('RPE 8.5–9.5');
    expect(push.stage.name).toBe('Decline push-up');
    expect(push.nextStage?.name).toBe('Close-grip push-up');
    expect(push.readiness).toMatchObject({ qualifying: 0, needed: 2, met: false });
  });

  it('prescribes repeating the top of the range at lower effort', () => {
    expect(push.nextAction).toBe(
      'Repeat 3×10–12 with consistent form and lower perceived effort for 2–3 sessions. Do not move on while sets are near failure.'
    );
  });

  it('turns green and moves on once the marker is met at the target effort', () => {
    const more = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
    ];
    const p = run(pushPlan(), more, '2026-09-25').paths[0];
    expect(p.light).toBe('green');
    expect(p.readiness?.met).toBe(true);
    expect(p.nextAction).toMatch(/^Move to close-grip push-up: start at 3 × 8–12/);
  });

  it('turns red when performance falls two sessions running', () => {
    const worse = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([10, 9, 8], [9, 9, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([9, 8, 6], [9, 9.5, 10]) }]),
    ];
    const p = run(pushPlan(), worse, '2026-09-25').paths[0];
    expect(p.light).toBe('red');
    expect(p.nextAction).toMatch(/drop a set/);
  });

  it('reports nothing logged for a stage with no sessions', () => {
    const p = run(pushPlan({}, { currentStageId: 'close-grip', history: [{ stageId: 'close-grip', startedOn: '2026-09-20' }] }), EXAMPLE, '2026-09-21').paths[0];
    expect(p.light).toBe('none');
    expect(p.nextAction).toMatch(/^Start close-grip push-up/);
  });
});

// ── Shared overrides ────────────────────────────────────

describe('holds, recovery gates and deloads', () => {
  it('a hold caps the light at yellow and replaces the advice', () => {
    const p = run(pushPlan({}, { hold: { kind: 'hold', reason: 'mild shoulder discomfort', since: '2026-09-16' } }), EXAMPLE, '2026-09-18').paths[0];
    expect(p.light).toBe('yellow');
    expect(p.reasons[0]).toBe('On hold since 2026-09-16: mild shoulder discomfort');
    expect(p.nextAction).toMatch(/do not progress until "mild shoulder discomfort" has resolved/);
  });

  it('a regress hold turns the light red', () => {
    const p = run(pushPlan({}, { hold: { kind: 'regress', reason: 'elbow pain', since: '2026-09-16' } }), EXAMPLE, '2026-09-18').paths[0];
    expect(p.light).toBe('red');
    expect(p.nextAction).toMatch(/^Step back to floor push-up/);
  });

  it('a warn-level recovery gate caps the light at yellow', () => {
    const sleep = Array.from({ length: 7 }, (_, i) => ({ key: `2026-09-${String(12 + i).padStart(2, '0')}`, value: 5 * 60 }));
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], effort: RIR, recoveryGates: [{ signal: 'sleep_hours', rule: 'below', threshold: 6, severity: 'warn' }] } });
    const routine = run(p, EXAMPLE, '2026-09-18', { series: id => (id === 'sleep_analysis' ? sleep : []) });
    expect(routine.recovery.status).toBe('warn');
    expect(routine.paths[0].light).toBe('yellow');
    expect(routine.paths[0].reasons.some(r => r.startsWith('Sleep: 5 h'))).toBe(true);
  });

  it('a deload block replaces "move on" advice', () => {
    const more = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
    ];
    const p = run(pushPlan({ blocks: [{ name: 'Deload week', startWeek: 8, weeks: 1, kind: 'deload' }] }), more, '2026-09-25').paths[0];
    expect(p.light).toBe('green');
    expect(p.nextAction).toMatch(/^Deload week: keep decline push-up and cut sets/);
  });
});

// ── Other models ────────────────────────────────────────

function liftPlan(model: string, stage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return plan({
    focusAreas: [{ name: 'Lifts', paths: [{ id: 'push', name: 'Bench', model, stages: [{ id: 'bench', name: 'Bench press', match: { names: ['Bench Press (Barbell)'] }, ...stage }] }] }],
    rules: { qualifyingSessions: [1, 1] },
    ...extra,
  });
}

describe('load model', () => {
  const stage = { prescription: { sets: [3, 3], reps: [5, 5], effort: { rpe: [7, 8.5] } } };

  it('adds the increment once every set reaches the top at the target effort', () => {
    const p = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [7, 8, 8.5], 80) }])], '2026-09-11').paths[0];
    expect(p.light).toBe('green');
    expect(p.rows[0].work).toBe('Bench press 3×5 @ 80 kg');
    expect(p.rows[0].headline).toBe('e1RM 93.5 kg');
    expect(p.nextAction).toBe('Add 2.5 kg: next session 82.5 kg for 3×5.');
  });

  it('holds when reps are made but effort was too high, and backs off after two misses', () => {
    const hard = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [8.5, 9, 9.5], 80) }])], '2026-09-11').paths[0];
    expect(hard.light).toBe('yellow-green');
    const missed = run(liftPlan('load', stage), [
      session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 4, 3], [9, 10, 10], 85) }]),
      session('2026-09-13', [{ name: 'Bench Press (Barbell)', sets: reps([5, 3, 3], [9, 10, 10], 85) }]),
    ], '2026-09-14').paths[0];
    expect(missed.light).toBe('red');
    expect(missed.nextAction).toBe('Back off 10% to 77.5 kg for 3×5 and build up again.');
  });

  it('shows loads in pounds for an imperial reader', () => {
    const p = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [7, 8, 8], 100) }])], '2026-09-11', { system: 'imperial' }).paths[0];
    expect(p.rows[0].work).toBe('Bench press 3×5 @ 220 lb');
  });
});

describe('percentage model', () => {
  it('prescribes from the running block and checks the sessions against it', () => {
    const p = liftPlan('percentage', { prescription: { sets: [3, 3], reps: [3, 3] } }, {
      blocks: [{ name: 'Peak', startWeek: 1, weeks: 12, kind: 'peak', targets: [{ pathId: 'push', label: 'Bench 3×3 @ 85–90%', dose: { sets: [3, 3], reps: [3, 3], load: { pct1rm: [85, 90] } } }] }],
    });
    (p.focusAreas[0].paths[0] as { params?: Record<string, unknown> }).params = { oneRepMaxKg: 100 };
    const r = run(p, [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([3, 3, 3], [8, 8, 8.5], 87.5) }])], '2026-09-11').paths[0];
    expect(r.nextAction).toBe('Next: 3 × 3 @ 85–90% 1RM (≈ 85–90 kg).');
    expect(r.rows[0].signal).toBe('On target');
    expect(r.light).toBe('green');
  });
});

describe('volume model', () => {
  const runPlan = plan({
    focusAreas: [{ name: 'Running', paths: [{ id: 'push', name: 'Weekly volume', model: 'volume', params: { metric: 'distanceM', maxWeeklyIncreasePct: 10 },
      stages: [{ id: 'base', name: 'Base', match: { names: [], workoutTypes: ['Running'] }, prescription: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } }, advanceWhen: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } } }] }] }],
    rules: { qualifyingSessions: [2, 2] },
    startDate: '2026-08-03',
  });
  const run_ = (id: string, date: string, km: number): WorkoutRecord => ({
    id, workout_type: 'Running', start_time: `${date}T12:00:00.000Z`, end_time: `${date}T12:50:00.000Z`,
    duration_minutes: km * 5.5, calories_burned: 400, source: 'Apple Watch', distance_km: km,
  });

  it('flags a week that ramps faster than the plan allows', () => {
    const workouts = [run_('a', '2026-09-01', 8), run_('b', '2026-09-03', 8), run_('c', '2026-09-08', 10), run_('d', '2026-09-10', 12)];
    const p = run(runPlan, [], '2026-09-15', { workouts }).paths[0];
    expect(p.light).toBe('yellow');
    expect(p.reasons[0]).toBe('Last week was 38% above the week before; the plan allows 10%.');
    expect(p.rows.map(r => r.work)).toEqual(['Week of Aug 31: 16 km', 'Week of Sep 7: 22 km', 'Week of Sep 14: 0 km']);
  });

  it('turns green after enough weeks on target', () => {
    const workouts = [run_('a', '2026-09-01', 10), run_('b', '2026-09-03', 11), run_('c', '2026-09-08', 11), run_('d', '2026-09-10', 11)];
    const p = run(runPlan, [], '2026-09-15', { workouts }).paths[0];
    expect(p.readiness).toMatchObject({ qualifying: 2, met: true, unit: 'weeks' });
    expect(p.light).toBe('green');
  });
});

describe('maintain model', () => {
  it('is green inside the range and yellow below it', () => {
    const p = plan({
      focusAreas: [{ name: 'Mobility', paths: [{ id: 'push', name: 'Hang', model: 'maintain', stages: [{ name: 'Dead hang', match: { names: ['Dead Hang'] }, prescription: { sets: [3, 3], holdS: [30, 60] } }] }] }],
    });
    const hold = (d: string, s: number[]) => session(d, [{ name: 'Dead Hang', sets: s.map(x => ({ durationS: x })) }]);
    expect(run(p, [hold('2026-09-10', [40, 35, 30])], '2026-09-11').paths[0].light).toBe('green');
    expect(run(p, [hold('2026-09-10', [40, 35, 20])], '2026-09-11').paths[0].light).toBe('yellow');
  });
});

// ── Schedule ────────────────────────────────────────────

describe('schedule', () => {
  const templates = [
    { id: 'a', name: 'Upper', slots: [{ pathIds: ['push'] }, { pathIds: ['push', 'pull'], optional: true, rotate: true }] },
    { id: 'b', name: 'Lower', slots: [{ pathIds: ['legs'] }] },
  ];
  const areas = [{ name: 'All', paths: [
    { id: 'push', name: 'Push', stages: [{ name: 'Push up', match: { names: ['Push Up'] } }] },
    { id: 'pull', name: 'Pull', stages: [{ name: 'Row', match: { names: ['Row'] } }] },
    { id: 'legs', name: 'Legs', stages: [{ name: 'Squat', match: { names: ['Squat'] } }] },
  ] }];
  const withSchedule = (schedule: unknown, extra: Record<string, unknown> = {}) => plan({ focusAreas: areas, templates, schedule, startDate: '2026-09-01', ...extra });
  const upper = (d: string) => session(d, [{ name: 'Push Up', sets: reps([10]) }]);
  const lower = (d: string) => session(d, [{ name: 'Squat', sets: reps([10]) }]);
  const next = (p: TrainingPlan, sessions: TrainingSession[], today: string) =>
    nextSession(p, completedSessions(p, sessions, [], dayOf), today, planWeek(p, today), 'metric');

  it('A/B/rest on completion follows what was actually done', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'] });
    expect(next(p, [upper('2026-09-10')], '2026-09-11').due.label).toBe('Lower');
    // B yesterday → today is the rest day; B two days ago → the rest day passed.
    expect(next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-12').due.kind).toBe('rest');
    expect(next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-13').due.label).toBe('Upper');
    const today = next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-11');
    expect(today.doneToday).toBe(true);
    expect(today.due.kind).toBe('rest');
  });

  it('rotates an optional slot session to session', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b'] });
    const first = next(p, [], '2026-09-02').due.templates[0].slots[1];
    const second = next(p, [upper('2026-09-02'), lower('2026-09-03')], '2026-09-04').due.templates[0].slots[1];
    expect([first.pathId, second.pathId]).toEqual(['push', 'pull']);
    expect(second.optional).toBe(true);
  });

  it('on/off and every-day cycles', () => {
    const onOff = withSchedule({ kind: 'cycle', days: ['a', 'rest'] });
    expect(next(onOff, [upper('2026-09-10')], '2026-09-11').due.kind).toBe('rest');
    expect(next(onOff, [upper('2026-09-10')], '2026-09-12').due.label).toBe('Upper');
    const daily = withSchedule({ kind: 'cycle', days: ['a'] });
    expect(next(daily, [upper('2026-09-10')], '2026-09-11').due.label).toBe('Upper');
  });

  it('calendar cycles count from the anchor', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'], advance: 'calendar', anchorDate: '2026-09-01' });
    expect(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(d => next(p, [], d).due.label)).toEqual(['Upper', 'Lower', 'Rest day', 'Upper']);
  });

  it('fixed weekdays', () => {
    const p = withSchedule({ kind: 'weekdays', days: { mon: 'a', thu: 'b' } });
    // 2026-09-14 is a Monday.
    expect(next(p, [], '2026-09-14').due.label).toBe('Upper');
    expect(next(p, [], '2026-09-15').due.kind).toBe('rest');
    expect(next(p, [], '2026-09-15').upcoming[0].label).toBe('Thu: Lower');
  });

  it('N sessions a week rests once the week is full', () => {
    const p = withSchedule({ kind: 'frequency', sessionsPerWeek: [2, 3], rotation: ['a', 'b'] });
    expect(next(p, [upper('2026-09-14')], '2026-09-15').due.label).toBe('Lower');
    const full = next(p, [upper('2026-09-14'), lower('2026-09-15'), upper('2026-09-16')], '2026-09-17');
    expect(full.due.kind).toBe('rest');
    expect(full.why).toBe('3 of 2–3 sessions this week.');
  });

  it('a block can override the schedule', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b'] }, {
      blocks: [{ name: 'Deload', startWeek: 2, weeks: 1, kind: 'deload', scheduleOverride: { kind: 'weekdays', days: { wed: 'a' } } }],
    });
    expect(next(p, [], '2026-09-09').scheduleKind).toBe('weekdays');
  });

  it('adherence compares logged with planned sessions', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'] });
    const done = completedSessions(p, [upper('2026-09-10'), lower('2026-09-11')], [], dayOf);
    const a = adherence(p, done, '2026-09-14', planWeek(p, '2026-09-14'));
    expect(a).toMatchObject({ windowDays: 14, planned: 9, completed: 2, status: 'watch' });
  });
});

// ── Plan-level views ────────────────────────────────────

describe('plan position and deloads', () => {
  it('reports the week, block status and target checks', () => {
    const p = pushPlan({
      blocks: [
        { name: 'Month 1', startWeek: 1, weeks: 4, targets: [
          { pathId: 'push', label: 'Push-ups 3×10–15', dose: { sets: [3, 3], reps: [10, 15] } },
          { pathId: 'push', label: 'Push-ups 3×16–20', dose: { sets: [3, 3], reps: [16, 20] } },
        ] },
        { name: 'Month 2', startWeek: 5, weeks: 4 },
        { name: 'Month 3', startWeek: 9, weeks: 4 },
      ],
    });
    const r = run(p, EXAMPLE, '2026-09-18');
    expect(r.week).toBe(7);
    expect(r.blocks.map(b => b.status)).toEqual(['behind', 'current', 'future']);
    // Any stage of the path counts: 12/12/10 decline push-ups meet 3×10–15; nothing reached 16.
    expect(r.blocks[0].targets.map(t => t.met)).toEqual([true, false]);
  });

  it('deloads fall due by the plan rule', () => {
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], deload: { everyWeeks: [4, 6], volumeReduction: [0.3, 0.5] } } });
    expect(deloadStatus(p, '2026-08-20').status).toBe('ok');
    expect(deloadStatus(p, '2026-09-01').status).toBe('due');
    expect(deloadStatus(p, '2026-09-18').status).toBe('overdue');
    expect(deloadStatus({ ...p, deloads: ['2026-09-07'] }, '2026-09-18').status).toBe('ok');
  });
});

describe('exercise matching', () => {
  it('ignores a "(Bodyweight)" qualifier but keeps other equipment distinct', () => {
    const p = pushPlan({}, { currentStageId: 'decline', history: [] });
    const logged = (name: string) => [session('2026-09-10', [{ name, sets: reps([10, 10, 10]) }])];
    expect(run(p, logged('Decline Push Up (Bodyweight)'), '2026-09-11').paths[0].rows).toHaveLength(1);
    expect(run(p, logged('Decline Push Up (Weighted)'), '2026-09-11').paths[0].rows).toHaveLength(0);
  });
});

describe('inferCurrentStages', () => {
  it('places each path on the furthest stage trained recently, with history', () => {
    const p = pushPlan({}, { currentStageId: 'floor', history: [] });
    const { plan: inferred, changes } = inferCurrentStages(p, EXAMPLE, [], dayOf, '2026-09-18');
    const path = inferred.focusAreas[0].paths[0];
    expect(path.currentStageId).toBe('decline');
    expect(path.history.map(h => [h.stageId, h.startedOn])).toEqual([
      ['floor', '2026-08-25'],
      ['decline', '2026-09-08'],
    ]);
    expect(changes).toEqual(['Horizontal push: Decline push-up (since 2026-09-08)']);
  });
});
