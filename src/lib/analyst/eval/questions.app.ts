// ── Evaluation questions 23-32 (design §12): the app itself, and data before the record ──

import { allOf, always, anyOf, app, has, lastDays, metric, text, winFrom, winIs, REF_KEY } from './match';
import type { EvalCall, EvalQuestion } from './types';

const appData = (capability: string, params?: Record<string, unknown>): EvalCall => ({ tool: 'get_app_data', args: { capability, ...(params ? { params } : {}) } });
const appWin = (check: (a: Record<string, unknown>) => boolean) => (p: Record<string, unknown>): boolean => check({ window: p.window });

export const QUESTIONS_APP: EvalQuestion[] = [
  {
    n: 23,
    text: 'Am I hitting my calorie target?',
    tools: ['get_app_data'],
    called: app('body.nutrition_adherence'),
    window: always,
    oracle: [appData('body.nutrition_adherence', { window: { lastDays: 28 } })],
    answer: 'The nutrition adherence lookup compares each logged day with the calorie target.',
  },
  {
    n: 24,
    text: 'How am I doing on my weight goal?',
    tools: ['get_app_data'],
    called: app('body.goal'),
    window: always,
    oracle: [appData('body.goal')],
    answer: 'The goal lookup shows the target, the trend and the progress so far.',
  },
  {
    n: 25,
    text: 'Is my data up to date?',
    tools: ['get_app_data'],
    called: app('app.pipeline'),
    window: always,
    oracle: [appData('app.pipeline')],
    answer: 'The pipeline lookup says when each source last delivered data.',
  },
  {
    n: 26,
    text: 'Are there any data problems I should know about?',
    tools: ['get_app_data'],
    called: app('app.data_quality'),
    window: always,
    oracle: [appData('app.data_quality')],
    answer: 'The data quality lookup lists the findings, if any.',
  },
  {
    n: 27,
    text: "What did this morning's briefing mean by recovery?",
    tools: ['get_app_data'],
    called: app('app.briefing'),
    window: always,
    oracle: [appData('app.briefing')],
    answer: "The briefing lookup holds today's briefing text and what it was based on.",
  },
  {
    n: 28,
    text: 'What were my weekly highlights for the last month?',
    tools: ['get_app_data'],
    called: app('insights.reports', p => p.kind === 'weekly'),
    window: always,
    oracle: [appData('insights.reports', { kind: 'weekly', count: 4 })],
    answer: 'The weekly reports of the last month are in the lookup, newest first.',
  },
  {
    n: 29,
    text: 'Where did I run most this year?',
    tools: ['get_app_data'],
    called: app('activity.coverage'),
    window: app('activity.coverage', appWin(a => winFrom('2026-01-01', REF_KEY)(a) || lastDays(365)(a))),
    oracle: [appData('activity.coverage', { window: { start: '2026-01-01', end: REF_KEY } })],
    answer: 'The activity coverage lookup shows which saved areas your workouts fell in this year.',
  },
  {
    n: 30,
    text: 'What can you look up for me?',
    tools: ['list_capabilities'],
    called: has('list_capabilities'),
    window: always,
    oracle: [{ tool: 'list_capabilities', args: {} }],
    answer: 'The capability list names everything the app holds and the tool that reads it.',
  },
  {
    n: 31,
    text: 'How does my VO2 max relate to my weekly workout minutes?',
    tools: ['get_metric_relationship', 'get_metric_series'],
    called: anyOf(
      has('get_metric_relationship', a => [a.x, a.y].some(m => text(m, /vo2/)) && [a.x, a.y].some(m => text(m, /exercise/))),
      allOf(has('get_metric_series', a => metric(a, /vo2/)), has('get_metric_series', a => metric(a, /exercise/)))
    ),
    window: always,
    oracle: [{ tool: 'get_metric_relationship', args: { x: 'vo2max', y: 'apple_exercise_time', window: { lastDays: 180 } } }],
    answer: 'The relationship lookup pairs the two metrics by day; it describes an association and says nothing about cause.',
  },
  {
    n: 32,
    text: 'Any workouts in 2024?',
    tools: ['get_workouts'],
    called: has('get_workouts'),
    window: has('get_workouts', winIs('2024-01-01', '2024-12-31')),
    status: 'no_data_in_window',
    oracle: [{ tool: 'get_workouts', args: { window: { start: '2024-01-01', end: '2024-12-31' } } }],
    answer: results => {
      const next = (results[0] as { next?: string }).next ?? '';
      return `The lookup found no workouts in 2024. ${next.slice(next.indexOf('The app holds'))}`;
    },
  },
];
