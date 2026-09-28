import { describe, expect, it } from 'vitest';
import { parsePartialJson, partialAnswer } from './partial-answer';

const FULL = JSON.stringify({
  title: 'Routine is on track',
  observed: ['Adherence is 8 of 8 sessions.', 'Decline push-up reached 12/12/11 ("top of range").'],
  interpretation: ['Ready to progress.'],
  uncertainty: ['Form is not recorded.'],
  evidence: [{ metricId: 'x', sampleCount: 3 }],
  followUps: ['What next?'],
});

describe('partial answer while streaming', () => {
  it('reads every prefix of a reply without throwing, growing monotonically', () => {
    let lastLines = 0;
    for (let n = 0; n <= FULL.length; n++) {
      const partial = partialAnswer(FULL.slice(0, n));
      if (n === 0) expect(partial).toBeNull();
      const lines = partial ? partial.observed.length + partial.interpretation.length + partial.uncertainty.length : 0;
      expect(lines).toBeGreaterThanOrEqual(lastLines);
      lastLines = lines;
    }
    expect(partialAnswer(FULL)).toEqual({
      title: 'Routine is on track',
      observed: ['Adherence is 8 of 8 sessions.', 'Decline push-up reached 12/12/11 ("top of range").'],
      interpretation: ['Ready to progress.'],
      uncertainty: ['Form is not recorded.'],
    });
  });

  it('shows a line as it grows, and drops a cut-off escape', () => {
    const cut = '{"title":"Routine","observed":["Adherence is 8 of';
    expect(partialAnswer(cut)).toMatchObject({ title: 'Routine', observed: ['Adherence is 8 of'] });
    expect(partialAnswer('{"title":"Say \\"hi\\')?.title).toBe('Say "hi');
    expect(partialAnswer('{"title":"caf\\u00e')?.title).toBe('caf');
    expect(partialAnswer('{"title":"caf\\u00e9"')?.title).toBe('café');
  });

  it('skips a code fence or preamble before the object, and leaves prose alone', () => {
    expect(partialAnswer('```json\n{"title":"T","observed":"one line"')).toMatchObject({ title: 'T', observed: ['one line'] });
    expect(partialAnswer('Let me check your routine first.')).toBeNull();
    expect(partialAnswer('{"ti')).toEqual({ title: '', observed: [], interpretation: [], uncertainty: [] });
  });

  it('parses partial literals, numbers and nesting', () => {
    expect(parsePartialJson('{"a":[1,2,{"b":tr')).toEqual({ a: [1, 2, {}] });
    expect(parsePartialJson('[true, null, -1.5e2]')).toEqual([true, null, -150]);
    expect(parsePartialJson('')).toBeUndefined();
  });
});
