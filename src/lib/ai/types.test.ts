import { describe, expect, it } from 'vitest';
import { parseOptions, selectionFor } from './types';
import { aiSettingsFor } from './test-settings';

describe('parseOptions', () => {
  it('keeps accepted analyst values, numbers given as text included', () => {
    expect(
      parseOptions('analyst', {
        maxTokens: '3000',
        temperature: 0.5,
        reasoningEffort: 'HIGH',
        jsonMode: 'off',
        tools: 'off',
        context: 'ondemand',
        contextMaxChars: 20000,
        maxReasoningChars: 5000,
        maxAnswerChars: 4000,
        labAssist: false,
      })
    ).toEqual({
      maxTokens: 3000,
      temperature: 0.5,
      reasoningEffort: 'high',
      jsonMode: 'off',
      tools: 'off',
      context: 'ondemand',
      contextMaxChars: 20000,
      maxReasoningChars: 5000,
      maxAnswerChars: 4000,
      labAssist: false,
    });
  });

  it('drops anything out of range, of the wrong kind, or unknown', () => {
    expect(
      parseOptions('analyst', { maxTokens: 0, temperature: 3, reasoningEffort: 'turbo', tools: 'maybe', contextMaxChars: 10, maxAnswerChars: 1.5, labAssist: 'no', extra: 1 })
    ).toEqual({});
    expect(parseOptions('analyst', null)).toEqual({});
    expect(parseOptions('analyst', [1, 2])).toEqual({});
  });

  it('gives the summary uses only their own fields', () => {
    expect(parseOptions('summary', { maxTokens: 5000, tools: 'off', context: 'ondemand', labAssist: false, reasoningEffort: 'low' })).toEqual({
      maxTokens: 5000,
      reasoningEffort: 'low',
    });
    expect(parseOptions('summary_fallback', { temperature: 0.1 })).toEqual({ temperature: 0.1 });
  });
});

describe('selectionFor', () => {
  it('pairs a use with its provider, and has nothing for a use with no choice', () => {
    const settings = aiSettingsFor({ analyst: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' } });
    expect(selectionFor(settings, 'analyst')).toMatchObject({ model: 'm', provider: { baseUrl: 'http://127.0.0.1:1/v1' } });
    expect(selectionFor(settings, 'summary')).toBeNull();
    expect(selectionFor({ ...settings, providers: [] }, 'analyst')).toBeNull();
  });
});
