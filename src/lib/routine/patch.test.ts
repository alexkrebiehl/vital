import { describe, expect, it } from 'vitest';
import { applyPlanOps } from './patch';

const doc = {
  title: 'Plan',
  focusAreas: [{ id: 'push', paths: [{ id: 'h', stages: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }] }],
};

describe('applyPlanOps', () => {
  it('sets, inserts and removes by id or position without touching the input', () => {
    const out = applyPlanOps(doc, [
      { op: 'set', path: 'focusAreas[push].paths[h].stages[a].name', value: 'A2' },
      { op: 'insert', path: 'focusAreas[push].paths[h].stages', index: 1, value: { id: 'mid', name: 'Mid' } },
      { op: 'remove', path: 'focusAreas[0].paths[h].stages[b]' },
      { op: 'set', path: 'title', value: 'Renamed' },
    ]) as typeof doc;
    expect(out.title).toBe('Renamed');
    expect(out.focusAreas[0].paths[0].stages.map(s => s.name)).toEqual(['A2', 'Mid']);
    expect(doc.focusAreas[0].paths[0].stages).toHaveLength(2);
  });

  it('names the failing op and the ids it could have meant', () => {
    expect(() => applyPlanOps(doc, [{ op: 'set', path: 'focusAreas[pull].paths', value: [] }])).toThrow(
      'ops[0] (set focusAreas[pull].paths): plan.focusAreas has no item with id "pull" (ids: push).'
    );
    expect(() => applyPlanOps(doc, [{ op: 'insert', path: 'focusAreas[push]', value: {} }])).toThrow(/insert takes the path of a list/);
    expect(() => applyPlanOps(doc, [])).toThrow(/non-empty/);
  });
});
