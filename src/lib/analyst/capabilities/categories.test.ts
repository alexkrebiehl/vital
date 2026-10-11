// ── The sending categories, in plain words (design §9.1) ────

import { describe, expect, it } from 'vitest';
import { SENDING_CATEGORY_SENTENCES, sendingSentences } from './categories';
import type { SendingCategory } from './types';

const ALL_CATEGORIES: SendingCategory[] = [
  'metric-summaries', 'daily-values', 'sleep-nights', 'blood-pressure', 'workouts', 'strength-sessions',
  'lab-results', 'medication-records', 'body-goal', 'profile-context', 'app-status', 'locations-coarse',
];

describe('the sending categories', () => {
  it('has one plain sentence per category', () => {
    expect(Object.keys(SENDING_CATEGORY_SENTENCES).sort()).toEqual([...ALL_CATEGORIES].sort());
    for (const c of ALL_CATEGORIES) {
      const s = SENDING_CATEGORY_SENTENCES[c];
      expect(s.length, c).toBeGreaterThan(20);
      expect(s, c).not.toMatch(/\n/);
    }
  });

  it('lists the sentences of the categories asked for, once each, in the canonical order', () => {
    const out = sendingSentences(['lab-results', 'workouts', 'workouts']);
    expect(out).toEqual([SENDING_CATEGORY_SENTENCES.workouts, SENDING_CATEGORY_SENTENCES['lab-results']]);
  });

  it('keeps the lab sentence naming lab results', () => {
    expect(SENDING_CATEGORY_SENTENCES['lab-results']).toMatch(/lab result/i);
  });
});
