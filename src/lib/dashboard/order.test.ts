import { describe, expect, it } from 'vitest';
import { moveCard, moveTarget } from './order';

const ids = ['a', 'b', 'c', 'd'];

describe('moveCard', () => {
  it('moves a card forward', () => expect(moveCard(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']));
  it('moves a card backward', () => expect(moveCard(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']));
  it('moves to either end', () => {
    expect(moveCard(ids, 1, 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveCard(ids, 1, 3)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('returns an unchanged copy for the same index', () => {
    const out = moveCard(ids, 2, 2);
    expect(out).toEqual(ids);
    expect(out).not.toBe(ids);
  });
  it('returns an unchanged copy when an index is out of range or not an integer', () => {
    for (const [from, to] of [[-1, 2], [1, 4], [4, 0], [0, -1], [1.5, 2], [NaN, 0]]) {
      const out = moveCard(ids, from, to);
      expect(out).toEqual(ids);
      expect(out).not.toBe(ids);
    }
  });
  it('does not change its input', () => {
    const input = [...ids];
    moveCard(input, 0, 3);
    expect(input).toEqual(ids);
  });
});

describe('moveTarget', () => {
  it('first card: nothing earlier or to the start', () => {
    expect(moveTarget(ids, 'a', 'earlier')).toBeNull();
    expect(moveTarget(ids, 'a', 'start')).toBeNull();
    expect(moveTarget(ids, 'a', 'later')).toBe(1);
    expect(moveTarget(ids, 'a', 'end')).toBe(3);
  });
  it('middle card: every command moves', () => {
    expect(moveTarget(ids, 'c', 'earlier')).toBe(1);
    expect(moveTarget(ids, 'c', 'later')).toBe(3);
    expect(moveTarget(ids, 'c', 'start')).toBe(0);
    expect(moveTarget(ids, 'c', 'end')).toBe(3);
  });
  it('last card: nothing later or to the end', () => {
    expect(moveTarget(ids, 'd', 'later')).toBeNull();
    expect(moveTarget(ids, 'd', 'end')).toBeNull();
    expect(moveTarget(ids, 'd', 'earlier')).toBe(2);
    expect(moveTarget(ids, 'd', 'start')).toBe(0);
  });
  it('second card to start and second-last to end are real moves', () => {
    expect(moveTarget(ids, 'b', 'start')).toBe(0);
    expect(moveTarget(ids, 'c', 'end')).toBe(3);
  });
  it('an unknown id or a single card does nothing', () => {
    expect(moveTarget(ids, 'zz', 'later')).toBeNull();
    for (const c of ['earlier', 'later', 'start', 'end'] as const) expect(moveTarget(['a'], 'a', c)).toBeNull();
  });
});
