// ── What each capability holds, in a phrase (design §5.1) ───
//
// Client-safe data, written once. The capability map renders these; no values, no
// dates, no counts and no digits (those change per request and belong in the message).

export const HOLDS: Record<string, string> = {
  'metrics.summary': 'daily metrics over the last N days against the N before',
  'metrics.compare': 'one daily metric over two periods you name',
  'metrics.series': 'daily metrics by day, week or month, any window',
  'metrics.relationship': 'how two metrics move together (association only)',
  'workouts.sessions': 'each workout: type, duration, distance, calories',
  'workouts.summary': 'workouts rolled up by week, type and month',
  'sleep.nights': 'each night: bedtimes, asleep, in bed, stages',
  'sleep.summary': 'sleep by week or month, longest and shortest nights',
  'heart.blood_pressure': 'blood pressure readings against the reference',
  'labs.series': 'lab results by analyte or category, with history',
  'labs.compare': 'two lab panel dates side by side',
  'medications.summary': 'the medication log, per medication',
  'medications.doses': 'each logged dose: day, time, medication, taken',
  'training.progress': 'plan progress: phase, stages, readiness, adherence',
  'training.plan': 'the active training plan document',
  'training.sessions': 'logged strength sessions with exercises and sets',
  'training.exercise_templates': 'exercise names and template ids',
  'training.reference_plans': 'complete example plans',
  'labs.documents': 'lab report dates, lab names and result counts',
  'body.goal': 'body goal, progress, weight trend, nutrition targets',
  'body.nutrition_adherence': 'logged days of food against the targets',
  'insights.current': 'current insights with evidence and caveats',
  'insights.reports': 'weekly and monthly reports',
  'activity.coverage': 'where workouts went, by saved map area',
  'activity.maps': 'the saved map areas',
  'app.data_quality': 'problems found in the data that arrived',
  'app.pipeline': 'connected sources, last delivery, stage health',
  'app.profile': 'age, sex, timezone and the reader\'s notes',
  'app.preferences': 'the unit system',
  'app.briefing': 'today\'s written briefing',
  'app.dashboard': 'the dashboard cards',
  'training.workout_template': 'one plan session template as a day of training',
};
