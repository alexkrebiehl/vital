// Reference plan: a 12-week barbell strength block — linear load progression on
// fixed weekdays, a deload, a short peak and a test week. One example of what the
// plan model can hold; the analyst fits the lifts, days and loads to the user.

const WORKING = { rpe: [7, 8.5] };

export function strengthTemplate(startDate: string): unknown {
  return {
    title: '12-week barbell strength block',
    goal: 'Raise the squat, bench press and deadlift with linear progression, then peak and test.',
    context: ['Three sessions a week in a gym with a barbell and plates.'],
    startDate,
    durationWeeks: 12,
    focusAreas: [
      {
        id: 'main-lifts',
        name: 'Main lifts',
        paths: [
          {
            id: 'squat', name: 'Back squat', model: 'load', params: { incrementKg: 2.5 }, priority: 'primary',
            stages: [{ id: 'back-squat', name: 'Back squat', match: { names: ['Squat (Barbell)', 'Back Squat'] },
              prescription: { sets: [3, 3], reps: [5, 5], effort: WORKING },
              cues: ['Brace before each rep', 'Hit depth'], checks: ['No knee or low-back pain'] }],
          },
          {
            id: 'bench', name: 'Bench press', model: 'load', params: { incrementKg: 2.5 }, priority: 'primary',
            stages: [{ id: 'bench-press', name: 'Bench press', match: { names: ['Bench Press (Barbell)'] },
              prescription: { sets: [3, 3], reps: [5, 5], effort: WORKING },
              cues: ['Shoulder blades pinned', 'Touch and press'], checks: ['No shoulder pain'] }],
          },
          {
            id: 'deadlift', name: 'Deadlift', model: 'load', params: { incrementKg: 5 }, priority: 'primary',
            stages: [{ id: 'deadlift', name: 'Deadlift', match: { names: ['Deadlift (Barbell)'] },
              prescription: { sets: [1, 2], reps: [5, 5], effort: WORKING },
              cues: ['Bar over mid-foot', 'Neutral spine'], checks: ['No low-back pain'] }],
          },
        ],
      },
      {
        id: 'accessories',
        name: 'Accessories',
        paths: [
          {
            id: 'row', name: 'Barbell row', model: 'load', params: { incrementKg: 2.5 }, priority: 'secondary',
            stages: [{ id: 'barbell-row', name: 'Barbell row', match: { names: ['Bent Over Row (Barbell)'] },
              prescription: { sets: [3, 3], reps: [8, 10], effort: WORKING }, cues: [], checks: [] }],
          },
          {
            id: 'press', name: 'Overhead press', model: 'load', params: { incrementKg: 1.25 }, priority: 'secondary',
            stages: [{ id: 'overhead-press', name: 'Overhead press', match: { names: ['Overhead Press (Barbell)'] },
              prescription: { sets: [3, 3], reps: [5, 8], effort: WORKING }, cues: [], checks: [] }],
          },
        ],
      },
    ],
    rules: {
      qualifyingSessions: [1, 1],
      effort: WORKING,
      lights: {
        green: ['All working sets completed at the prescribed reps with RPE ≤ 8.5'],
        yellow: ['Reps completed but RPE 9+', 'One missed rep'],
        red: ['Two sessions in a row with missed reps', 'Joint pain'],
      },
      doNotProgressIf: ['Form breaks down on the last set', 'Any joint pain'],
      deload: { everyWeeks: [8, 9], volumeReduction: [0.4, 0.5] },
      recoveryGates: [
        { signal: 'sleep_hours', rule: 'below', threshold: 6.5, severity: 'warn' },
        { signal: 'resting_hr', rule: 'rising', threshold: 4, severity: 'watch' },
      ],
    },
    blocks: [
      { id: 'linear', name: 'Linear progression', startWeek: 1, weeks: 8, kind: 'build',
        goals: ['Add weight every session the prescription is met'], targets: [] },
      { id: 'deload', name: 'Deload', startWeek: 9, weeks: 1, kind: 'deload',
        goals: ['Half the sets at the same weights'], targets: [] },
      { id: 'peak', name: 'Peak', startWeek: 10, weeks: 2, kind: 'peak',
        goals: ['Heavy triples and doubles'],
        targets: [
          { pathId: 'squat', label: 'Squat 3×3 @ 85–90%', dose: { sets: [3, 3], reps: [3, 3], load: { pct1rm: [85, 90] } } },
          { pathId: 'bench', label: 'Bench 3×3 @ 85–90%', dose: { sets: [3, 3], reps: [3, 3], load: { pct1rm: [85, 90] } } },
          { pathId: 'deadlift', label: 'Deadlift 2×2 @ 88–92%', dose: { sets: [2, 2], reps: [2, 2], load: { pct1rm: [88, 92] } } },
        ] },
      { id: 'test', name: 'Test week', startWeek: 12, weeks: 1, kind: 'test',
        goals: ['Work up to a new one-rep max on each main lift'], targets: [] },
    ],
    templates: [
      { id: 'heavy-a', name: 'A: Squat, bench, row', minutes: 75,
        slots: [{ pathIds: ['squat'] }, { pathIds: ['bench'] }, { pathIds: ['row'], optional: true }] },
      { id: 'heavy-b', name: 'B: Squat, press, deadlift', minutes: 75,
        slots: [{ pathIds: ['squat'] }, { pathIds: ['press'] }, { pathIds: ['deadlift'] }] },
    ],
    schedule: { kind: 'weekdays', days: { mon: 'heavy-a', wed: 'heavy-b', fri: 'heavy-a' } },
  };
}
