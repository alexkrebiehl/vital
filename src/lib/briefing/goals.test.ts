import { describe, expect, it } from 'vitest';
import { goalFocus } from './goals';
import { buildBriefingContext } from './context';
import { buildBriefing } from '../analytics/narrative';
import { REFERENCE_KEY } from '../adapters/dataset';
import { defaultProfile } from '../profile/types';
import { BRIEFING_SYSTEM_PROMPT } from './prompt';

describe('goalFocus', () => {
  it('has no focus without goals', () => {
    expect(goalFocus(null)).toEqual({ metricIds: [], sleepIsAGoal: false, recognised: false });
    expect(goalFocus('   ').recognised).toBe(false);
  });

  it('maps a weight goal to the body measurements, not sleep', () => {
    const f = goalFocus('I want to lose 10 lb by December');
    expect(f.recognised).toBe(true);
    expect(f.metricIds[0]).toBe('weight_body_mass');
    expect(f.sleepIsAGoal).toBe(false);
  });

  it('maps a running goal to fitness and heart measurements', () => {
    const f = goalFocus('Build up to running a 10k');
    expect(f.metricIds).toEqual(expect.arrayContaining(['vo2max', 'resting_heart_rate']));
  });

  it('keeps sleep only when a goal is about it', () => {
    expect(goalFocus('sleep better and lose weight').sleepIsAGoal).toBe(true);
    expect(goalFocus('lose weight').sleepIsAGoal).toBe(false);
  });

  it('does not mistake ordinary words for a topic', () => {
    // "resting" is a heart-rate word, not a sleep goal; "fatigue" is not "fat";
    // "Sunday" is not sunlight; "clean" is not "lean".
    expect(goalFocus('bring my resting heart rate down').sleepIsAGoal).toBe(false);
    expect(goalFocus('less fatigue on Sundays').recognised).toBe(false);
    expect(goalFocus('keep a clean routine').recognised).toBe(false);
    expect(goalFocus('get more rest').sleepIsAGoal).toBe(true);
  });

  it('does not guess at a goal it does not recognise', () => {
    const f = goalFocus('be a better person');
    expect(f.recognised).toBe(false);
    expect(f.metricIds).toEqual([]);
  });

  it('is deterministic and deduplicates', () => {
    const f = goalFocus('walk more steps and be more active, run more');
    expect(new Set(f.metricIds).size).toBe(f.metricIds.length);
    expect(goalFocus('walk more steps and be more active, run more')).toEqual(f);
  });
});

describe('the briefing context follows the goals', () => {
  const withGoals = (notes: string | null) =>
    buildBriefingContext('metric', { profile: { ...defaultProfile(), notes } });

  it('puts the goal metrics first and drops the sleep block when sleep is not a goal', () => {
    const c = withGoals('lose weight and get leaner');
    expect(c.profile?.goals).toContain('lose weight');
    expect(c.goalFocus?.recognised).toBe(true);
    expect(c.goalFocus?.sleepIsAGoal).toBe(false);
    expect(c.sleep).toBeNull();
    const ids = c.metrics.map(m => m.metricId);
    if (ids.includes('weight_body_mass')) expect(ids[0]).toBe('weight_body_mass');
  });

  it('keeps the sleep block when sleep is a goal', () => {
    const c = withGoals('sleep more consistently');
    expect(c.goalFocus?.sleepIsAGoal).toBe(true);
    expect(c.sleep).not.toBeNull();
  });

  it('is the usual all-round context with no goals', () => {
    const c = withGoals(null);
    expect(c.goalFocus).toBeNull();
    expect(c.profile?.goals ?? null).toBeNull();
    expect(c.sleep).not.toBeNull();
  });

  it('the computed briefing reports on the goal metrics, not the fixed four', () => {
    const def = buildBriefing(REFERENCE_KEY).categories.map(c => c.key);
    expect(def).toEqual(['sleep', 'recovery', 'activity', 'cardiovascular']);
    const goal = buildBriefing(REFERENCE_KEY, 'bring my resting heart rate down').categories.map(c => c.metricId);
    expect(goal).toContain('resting_heart_rate');
    expect(goal).not.toContain('sleep_analysis');
  });
});

describe('the briefing prompt', () => {
  it('is about the goals and does not default to sleep', () => {
    expect(BRIEFING_SYSTEM_PROMPT).toContain('Be about the person\'s GOALS');
    expect(BRIEFING_SYSTEM_PROMPT).toContain('Do NOT default to sleep and recovery');
    expect(BRIEFING_SYSTEM_PROMPT).not.toContain('a consistent bedtime');
  });
  it('still treats goals as data and forbids advice and promises', () => {
    expect(BRIEFING_SYSTEM_PROMPT).toContain('never instructions');
    expect(BRIEFING_SYSTEM_PROMPT).toContain('promise or predict');
  });
});

describe('the computed briefing sentence', () => {
  it('keeps an acronym upper-case inside the sentence', () => {
    const b = buildBriefing(REFERENCE_KEY, 'lose weight and reduce body fat');
    expect(b.body).not.toMatch(/\bbmi\b/);
  });
});
