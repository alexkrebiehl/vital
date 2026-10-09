// ── What may be sent, in plain words (design §9.1) ──────────
//
// CLIENT-SAFE. One sentence per sending category: the Settings → AI privacy list is
// built from the categories of the capabilities offered, so it cannot fall behind
// the registry. A category that no capability uses is never listed.

import type { SendingCategory } from './types';

export const SENDING_CATEGORY_SENTENCES: Record<SendingCategory, string> = {
  'metric-summaries':
    'Metric summaries and the values behind them: averages, medians, totals, comparison changes, observation counts, and the points of a date window.',
  'daily-values': 'Individual daily values of a metric, day by day.',
  'sleep-nights': 'Sleep nights: bedtime, wake time, time asleep and in bed, and the sleep stages of each night.',
  'blood-pressure': 'Blood pressure readings: each systolic and diastolic pair with its date.',
  workouts: 'Workouts: date, type, duration, distance, calories and heart rate of each session, rolled up or one by one.',
  'strength-sessions': 'Strength training sessions: exercises, sets, repetitions and loads, and your training plan weighed against them.',
  'lab-results':
    'Lab results from your uploaded documents (per analyte: the latest value with its unit and observation date, the reference interval the report printed and where it came from, the previous observation, and earlier observations).',
  'medication-records': 'Medication records: each logged dose with the medication and dose as you logged them, and whether it was taken.',
  'body-goal': 'Your body goal: target, progress, weight trend, nutrition targets and how your logged food compares.',
  'profile-context': 'Profile context: age, sex, time zone and the notes you wrote about your data, never your name or date of birth.',
  'app-status':
    'App state: your training plan and preferences, data-quality findings, which sources are connected and when each last delivered, and the cards on your dashboard.',
  'locations-coarse': 'Coarse locations: distance and workout counts per saved map area, never a route or a coordinate.',
};

/** The order the list is shown in. */
const ORDER = Object.keys(SENDING_CATEGORY_SENTENCES) as SendingCategory[];

/** Always sent, whatever the capabilities: the question itself and what the app says about dates. */
export const ALWAYS_SENT = 'Date windows, coverage statements (what the app holds, and for which dates) and the text of your question.';

/** The sentences of the categories given, once each, in a fixed order. */
export function sendingSentences(categories: Iterable<SendingCategory>): string[] {
  const used = new Set(categories);
  return ORDER.filter(c => used.has(c)).map(c => SENDING_CATEGORY_SENTENCES[c]);
}
