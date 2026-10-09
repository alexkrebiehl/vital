import { describe, expect, it } from 'vitest';
import { assertNumberRule, COUNT_KEYS, numberRuleViolations } from './number-rule';

describe('the number rule', () => {
  it('passes a measurement with a display string beside it', () => {
    expect(numberRuleViolations({ value: 61, display: '61 bpm' })).toEqual([]);
    expect(numberRuleViolations({ rows: [{ asleep: 432, display: { asleep: '7:12' } }] })).toEqual([]);
  });

  it('fails a bare measurement and says where', () => {
    expect(numberRuleViolations({ rows: [{ day: '2026-10-08', duration: 45 }] })).toEqual(['$.rows[0].duration: 45 has no display string beside it']);
  });

  it('fails a display that is not text or an object of text', () => {
    expect(numberRuleViolations({ value: 1, display: 3 }).some(v => v.startsWith('$.display:'))).toBe(true);
    expect(numberRuleViolations({ value: 1, display: null }).some(v => v.startsWith('$.display:'))).toBe(true);
    expect(numberRuleViolations({ value: 1, display: null }).some(v => v.startsWith('$.value:'))).toBe(true);
  });

  it('lets the count keys stand alone', () => {
    const counts = Object.fromEntries([...COUNT_KEYS].map(k => [k, 3]));
    expect(numberRuleViolations(counts)).toEqual([]);
    expect([...COUNT_KEYS].sort()).toEqual(['coefficient', 'count', 'limit', 'nextOffset', 'nights', 'observations', 'offset', 'pairedDays', 'returned', 'sessions', 'total']);
  });

  it('never lets a number that is not a number through, even with a display', () => {
    expect(numberRuleViolations({ value: Number.NaN, display: '—' })).toHaveLength(1);
    expect(numberRuleViolations({ count: Infinity })).toHaveLength(1);
  });

  it('fails an array of bare numbers', () => {
    expect(numberRuleViolations({ series: [1, 2, 3] })).toHaveLength(1);
  });

  it('throws with every violation listed', () => {
    let message = '';
    try {
      assertNumberRule({ a: 1, b: { c: 2 } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('$.a');
    expect(message).toContain('$.b.c');
    expect(() => assertNumberRule({ a: 1, display: 'one' })).not.toThrow();
  });

  it('ignores strings, booleans and nulls', () => {
    expect(numberRuleViolations({ day: '2026-10-08', ok: true, none: null, nested: { text: 'x' } })).toEqual([]);
  });
});
