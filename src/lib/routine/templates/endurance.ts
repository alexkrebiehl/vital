// Reference plan: a 12-week 10k build — easy-volume ramp, a lengthening long run
// and a tempo session, three or four runs a week on any days. Works from Apple
// Health running workouts alone (no workout-source plugin). One example of what
// the plan model can hold; the analyst fits it to the user's current mileage.

export function enduranceTemplate(startDate: string): unknown {
  return {
    title: '12-week 10k build',
    goal: 'Run a strong 10k: build weekly volume safely, extend the long run and sharpen pace.',
    context: ['Three to four runs a week, any days.'],
    startDate,
    durationWeeks: 12,
    focusAreas: [
      {
        id: 'running',
        name: 'Running',
        paths: [
          {
            id: 'weekly-volume', name: 'Weekly volume', model: 'volume', priority: 'primary',
            params: { metric: 'distanceM', maxWeeklyIncreasePct: 10 },
            stages: [
              { id: 'base', name: 'Base volume', match: { names: [], workoutTypes: ['Running', 'Outdoor Run', 'Indoor Run'] },
                prescription: { weeklyVolume: { metric: 'distanceM', range: [15000, 22000] }, hrZone: [1, 2] },
                advanceWhen: { weeklyVolume: { metric: 'distanceM', range: [20000, 22000] } },
                cues: ['Mostly conversational pace'], checks: ['No shin or knee pain'] },
              { id: 'build', name: 'Build volume', match: { names: [], workoutTypes: ['Running', 'Outdoor Run', 'Indoor Run'] },
                prescription: { weeklyVolume: { metric: 'distanceM', range: [22000, 32000] } },
                advanceWhen: { weeklyVolume: { metric: 'distanceM', range: [30000, 32000] } },
                cues: ['Keep easy runs easy'], checks: ['No shin or knee pain'] },
            ],
          },
          {
            id: 'long-run', name: 'Long run', model: 'variation', priority: 'primary',
            stages: [
              { id: 'long-8k', name: 'Long run 8 km', match: { names: ['Long Run'], workoutTypes: ['Running'] },
                prescription: { distanceM: [7000, 8000], hrZone: [2, 2] }, advanceWhen: { distanceM: [8000, 8500] }, cues: ['Easy effort throughout'], checks: [] },
              { id: 'long-10k', name: 'Long run 10 km', match: { names: ['Long Run'], workoutTypes: ['Running'] },
                prescription: { distanceM: [9000, 10000], hrZone: [2, 2] }, advanceWhen: { distanceM: [10000, 10500] }, cues: [], checks: [] },
              { id: 'long-12k', name: 'Long run 12 km', match: { names: ['Long Run'], workoutTypes: ['Running'] },
                prescription: { distanceM: [11000, 12000], hrZone: [2, 2] }, cues: [], checks: [] },
            ],
          },
          {
            id: 'tempo', name: 'Tempo pace', model: 'maintain', priority: 'secondary',
            stages: [
              { id: 'tempo', name: 'Tempo run', match: { names: ['Tempo Run'], workoutTypes: ['Running'] },
                prescription: { durationS: [1200, 1800], hrZone: [3, 4] }, cues: ['Comfortably hard'], checks: [] },
            ],
          },
        ],
      },
    ],
    rules: {
      qualifyingSessions: [2, 2],
      lights: {
        green: ['Weekly volume on target and rising no faster than 10% a week'],
        yellow: ['Volume jumped more than 10% in a week', 'Missed runs'],
        red: ['Pain that changes your stride', 'Two weeks of falling volume'],
      },
      doNotProgressIf: ['Any pain that changes how you run'],
      recoveryGates: [
        { signal: 'resting_hr', rule: 'rising', threshold: 4, severity: 'watch' },
        { signal: 'sleep_hours', rule: 'below', threshold: 6.5, severity: 'warn' },
        { signal: 'training_load', rule: 'rising', threshold: 30, severity: 'watch', note: 'A sudden jump in load is an injury risk.' },
      ],
    },
    blocks: [
      { id: 'base', name: 'Base', startWeek: 1, weeks: 5, kind: 'build', goals: ['Consistent easy running'], targets: [] },
      { id: 'build', name: 'Build', startWeek: 6, weeks: 4, kind: 'build', goals: ['Longer long run, weekly tempo'], targets: [] },
      { id: 'recover', name: 'Recovery week', startWeek: 10, weeks: 1, kind: 'deload', goals: ['Cut volume by a third'], targets: [] },
      { id: 'taper', name: 'Taper and race', startWeek: 11, weeks: 2, kind: 'taper', goals: ['Stay sharp, arrive fresh', 'Race the 10k'], targets: [] },
    ],
    templates: [
      { id: 'easy', name: 'Easy run', slots: [{ pathIds: ['weekly-volume'], dose: { durationS: [1800, 2700], hrZone: [1, 2] } }] },
      { id: 'long', name: 'Long run', slots: [{ pathIds: ['long-run'] }] },
      { id: 'tempo', name: 'Tempo run', slots: [{ pathIds: ['tempo'] }] },
    ],
    schedule: { kind: 'frequency', sessionsPerWeek: [3, 4], rotation: ['easy', 'long', 'easy', 'tempo'], minRestHours: 20 },
  };
}
