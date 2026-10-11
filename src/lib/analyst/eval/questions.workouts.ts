// ── Evaluation questions 1-9 (design §12): workouts, training sessions, sleep ──

import { allOf, always, anyOf, has, lastDays, span, spansAtLeast, text, winFrom, winIs, REF_KEY } from './match';
import { MAR, YEAR } from './windows';
import type { EvalQuestion } from './types';


export const QUESTIONS_WORKOUTS: EvalQuestion[] = [
  {
    n: 1,
    text: 'How was my last workout?',
    tools: ['get_workouts'],
    called: has('get_workouts', a => a.limit === 1 && a.view !== 'summary'),
    window: always,
    oracle: [{ tool: 'get_workouts', args: { window: { lastDays: 30 }, limit: 1 } }],
    answer: 'Your last workout is the one the lookup returned, with its type, time and duration as shown there.',
  },
  {
    n: 2,
    text: 'How many workouts did I do in March?',
    tools: ['get_workouts'],
    called: has('get_workouts', a => a.view === 'summary'),
    window: has('get_workouts', MAR),
    oracle: [{ tool: 'get_workouts', args: { window: { month: '2026-03' }, view: 'summary' } }],
    answer: 'The March workout summary lists the total sessions, as shown in the lookup.',
  },
  {
    n: 3,
    text: 'Show my runs longer than 45 minutes this summer',
    tools: ['get_workouts'],
    called: has('get_workouts', a => text(a.type, /^running$/i) && a.sort === 'duration'),
    window: has('get_workouts', winIs('2026-06-01', '2026-08-31')),
    oracle: [{ tool: 'get_workouts', args: { window: { start: '2026-06-01', end: '2026-08-31' }, type: 'Running', sort: 'duration', order: 'desc' } }],
    answer: 'The longest summer runs are listed in the lookup, longest first.',
  },
  {
    n: 4,
    text: 'Are my workouts associated with better sleep?',
    tools: ['get_workouts', 'get_sleep'],
    called: allOf(has('get_workouts'), has('get_sleep')),
    window: calls => {
      const of = (tool: string) => calls.filter(c => c.tool === tool).map(c => span((c.args as { window?: unknown }).window));
      return of('get_workouts').some(w => w !== null && of('get_sleep').some(s => s !== null && s.start === w.start && s.end === w.end) && Date.parse(w.end) - Date.parse(w.start) >= 27 * 86_400_000);
    },
    oracle: [
      { tool: 'get_workouts', args: { window: { lastDays: 90 }, view: 'summary' } },
      { tool: 'get_sleep', args: { window: { lastDays: 90 }, view: 'summary' } },
    ],
    answer: 'Both summaries cover the same ninety days; the workout and sleep means are in the lookups, and this is an association, not a cause.',
  },
  {
    n: 5,
    text: 'What did I lift on my last strength day?',
    tools: ['get_workouts', 'get_training_sessions'],
    called: anyOf(has('get_workouts', a => a.detail === true), has('get_training_sessions')),
    window: always,
    oracle: [{ tool: 'get_workouts', args: { window: { lastDays: 30 }, type: 'Strength Training', detail: true, limit: 1 } }],
    answer: 'The last strength session and its exercises are in the lookup.',
  },
  {
    n: 6,
    text: 'How has my bench press progressed?',
    tools: ['get_training_sessions'],
    called: has('get_training_sessions', a => text(a.exercise, /bench/i)),
    window: always,
    oracle: [{ tool: 'get_training_sessions', args: { exercise: 'bench', days: 365 } }],
    answer: 'The bench press sessions are listed newest first in the lookup, with their sets.',
  },
  {
    n: 7,
    text: 'What were my deepest sleep nights this year?',
    tools: ['get_sleep'],
    called: has('get_sleep', a => a.sort === 'deep' && a.order !== 'asc'),
    window: has('get_sleep', YEAR),
    oracle: [{ tool: 'get_sleep', args: { window: { start: '2026-01-01', end: REF_KEY }, sort: 'deep', order: 'desc', limit: 10 } }],
    answer: 'The nights with the most deep sleep this year are listed in the lookup, deepest first.',
  },
  {
    n: 8,
    text: 'How much REM did I get last week?',
    tools: ['get_sleep'],
    called: has('get_sleep'),
    window: has('get_sleep', lastDays(7)),
    oracle: [{ tool: 'get_sleep', args: { window: { lastDays: 7 } } }],
    answer: 'The REM time of each night of the last week is in the lookup.',
  },
  {
    n: 9,
    text: 'When do I usually go to bed on weekends?',
    tools: ['get_sleep'],
    called: has('get_sleep', a => a.sort === 'bedtime'),
    window: has('get_sleep', spansAtLeast(28)),
    oracle: [{ tool: 'get_sleep', args: { window: { lastDays: 90 }, sort: 'bedtime', limit: 31 } }],
    answer: 'The bedtimes in the lookup show when you went to bed; the weekend nights are among them.',
  },
];
