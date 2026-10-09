// ── Evaluation questions 10-22 (design §12): sleep comparison, metrics, blood pressure, labs, medications, nutrition ──

import { allOf, always, anyOf, app, compareIs, count, has, lastDays, metric, text, winFrom, winIs, REF_KEY } from './match';
import { AUG_SEP, PANELS, SEP, W1, W2 } from './windows';
import type { EvalCall, EvalQuestion } from './types';

const hrv = /hrv|heart_rate_variability/;
const appData = (capability: string, params?: Record<string, unknown>): EvalCall => ({ tool: 'get_app_data', args: { capability, ...(params ? { params } : {}) } });

export const QUESTIONS_SERIES: EvalQuestion[] = [
  {
    n: 10,
    text: 'How did my sleep in August compare with September?',
    tools: ['get_sleep', 'get_metric_series'],
    called: anyOf(
      calls => count(calls, 'get_sleep', a => a.view === 'summary') >= 2,
      has('get_metric_series', a => metric(a, /sleep/) && typeof a.compareTo === 'object')
    ),
    window: anyOf(
      allOf(...AUG_SEP.map(([, w]) => has('get_sleep', a => a.view === 'summary' && w(a)))),
      has('get_metric_series', a => metric(a, /sleep/) && ((AUG_SEP[0][1](a) && compareIs(a, '2026-09-01', '2026-09-30')) || (SEP(a) && compareIs(a, '2026-08-01', '2026-08-31'))))
    ),
    oracle: AUG_SEP.map(([m]) => ({ tool: 'get_sleep', args: { window: { month: m }, view: 'summary' } })),
    answer: 'The August and September sleep summaries are in the two lookups, side by side.',
  },
  {
    n: 11,
    text: "What's my resting heart rate trend over 6 months?",
    tools: ['get_metric_series'],
    called: has('get_metric_series', a => metric(a, /resting_heart_rate/) && a.granularity === 'week'),
    window: has('get_metric_series', lastDays(180)),
    oracle: [{ tool: 'get_metric_series', args: { metrics: ['resting_heart_rate'], window: { lastDays: 180 }, granularity: 'week' } }],
    answer: 'The weekly resting heart rate for six months is in the lookup, with the change against the six months before.',
  },
  {
    n: 12,
    text: 'Compare my HRV the week of Sept 22 with the week of Sept 29',
    tools: ['get_metric_series'],
    called: has('get_metric_series', a => metric(a, hrv) && typeof a.compareTo === 'object'),
    window: has('get_metric_series', a => (winIs(...W1)(a) && compareIs(a, ...W2)) || (winIs(...W2)(a) && compareIs(a, ...W1))),
    oracle: [{ tool: 'get_metric_series', args: { metrics: ['heart_rate_variability'], window: { start: W1[0], end: W1[1] }, compareTo: { start: W2[0], end: W2[1] }, granularity: 'summary' } }],
    answer: 'The HRV summary of the first week and its change against the second week are in the lookup.',
  },
  {
    n: 13,
    text: 'What was my step count on 2026-09-14?',
    tools: ['get_metric_series'],
    called: has('get_metric_series', a => metric(a, /step/)),
    window: has('get_metric_series', winIs('2026-09-14', '2026-09-14')),
    oracle: [{ tool: 'get_metric_series', args: { metrics: ['step_count'], window: { day: '2026-09-14' } } }],
    answer: 'The step count of that day is in the lookup.',
  },
  {
    n: 14,
    text: 'Has my blood pressure gone down since July?',
    tools: ['get_blood_pressure'],
    called: has('get_blood_pressure', a => a.view === 'summary'),
    window: has('get_blood_pressure', winFrom('2026-07-01', '2026-10-07')),
    oracle: [{ tool: 'get_blood_pressure', args: { window: { start: '2026-07-01', end: REF_KEY }, view: 'summary' } }],
    answer: 'The summary gives the mean pair since July and the change against the window before; it is a reference comparison, not a diagnosis.',
  },
  {
    n: 15,
    text: 'Which readings were above 130/80 last month?',
    tools: ['get_blood_pressure'],
    called: has('get_blood_pressure', a => a.aboveReferenceOnly === true),
    window: has('get_blood_pressure', SEP),
    oracle: [{ tool: 'get_blood_pressure', args: { window: { month: '2026-09' }, aboveReferenceOnly: true } }],
    answer: 'The readings above the 120/80 reference last month are listed in the lookup; it flags against 120/80, so check each pair against 130/80 yourself.',
  },
  {
    n: 16,
    text: 'Show my blood pressure next to my cholesterol',
    tools: ['get_blood_pressure', 'get_lab_results'],
    called: allOf(has('get_blood_pressure'), has('get_lab_results', a => text(a.category, /lipid|cholest/i) || (Array.isArray(a.analytes) && a.analytes.some(x => text(x, /ldl|hdl|cholest/i))))),
    window: always,
    oracle: [
      { tool: 'get_blood_pressure', args: { window: { lastDays: 120 } } },
      { tool: 'get_lab_results', args: { category: 'Lipids' } },
    ],
    answer: 'The blood pressure readings and the lipid panel results are in the two lookups.',
  },
  {
    n: 17,
    text: 'What was my last LDL?',
    tools: ['get_lab_results'],
    called: has('get_lab_results', a => Array.isArray(a.analytes) && a.analytes.some(x => text(x, /ldl/i))),
    window: always,
    oracle: [{ tool: 'get_lab_results', args: { analytes: ['ldl'] } }],
    answer: 'The latest LDL result is in the lookup with its unit, date and reference interval.',
  },
  {
    n: 18,
    text: 'How has my A1c changed across panels?',
    tools: ['get_lab_results'],
    called: has('get_lab_results', a => a.history === true && Array.isArray(a.analytes) && a.analytes.some(x => text(x, /a1c/i))),
    window: always,
    oracle: [{ tool: 'get_lab_results', args: { analytes: ['a1c'], history: true } }],
    answer: 'Every A1c result is in the lookup, oldest to newest, each with its date.',
  },
  {
    n: 19,
    text: 'What changed between my last two lab panels?',
    tools: ['compare_lab_panels'],
    called: has('compare_lab_panels'),
    window: has('compare_lab_panels', a => [a.dateA, a.dateB].sort().join() === [...PANELS].join()),
    oracle: [{ tool: 'compare_lab_panels', args: { dateA: PANELS[0], dateB: PANELS[1], changedOnly: true } }],
    answer: 'The analytes whose value or status differs between the two panels are in the lookup.',
  },
  {
    n: 20,
    text: 'When was my last blood test and from which lab?',
    tools: ['get_app_data'],
    called: app('labs.documents'),
    window: always,
    oracle: [appData('labs.documents')],
    answer: 'The lab documents lookup lists each report with its date and lab.',
  },
  {
    n: 21,
    text: 'Did I log every dose last month?',
    tools: ['get_medications'],
    called: has('get_medications', a => a.view === 'doses'),
    window: has('get_medications', SEP),
    oracle: [{ tool: 'get_medications', args: { window: { month: '2026-09' }, view: 'doses' } }],
    answer: 'The dose records of last month are in the lookup, with the status of each dose.',
  },
  {
    n: 22,
    text: 'How much protein did I eat on average in September?',
    tools: ['get_metric_series'],
    called: has('get_metric_series', a => metric(a, /protein/)),
    window: has('get_metric_series', SEP),
    oracle: [{ tool: 'get_metric_series', args: { metrics: ['dietary_protein'], window: { month: '2026-09' }, granularity: 'summary' } }],
    answer: 'The September protein summary with its mean per logged day is in the lookup.',
  },
];
