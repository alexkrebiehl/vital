import { describe, expect, it } from 'vitest';
import { getCategories, getMetric } from '@/lib/metrics';
import { CATEGORY_LABELS, pickerGroups } from './picker';

const all = () => true;
const ids = (groups: ReturnType<typeof pickerGroups>) => groups.flatMap(g => g.metrics.map(m => m.id));

describe('pickerGroups', () => {
  it('lists categories in registry order with their labels', () => {
    const groups = pickerGroups('', undefined, all);
    expect(groups.map(g => g.category)).toEqual(getCategories());
    expect(groups[0].label).toBe(CATEGORY_LABELS[groups[0].category]);
  });

  it('labels every category from one map', () => {
    expect(CATEGORY_LABELS).toEqual({
      cardiovascular: 'Cardiovascular',
      activity: 'Activity',
      sleep: 'Sleep',
      body: 'Body',
      nutrition: 'Nutrition',
      respiratory: 'Respiratory',
      recovery: 'Recovery',
      vitals: 'Vitals',
    });
  });

  it('puts each metric under its own category with its display name', () => {
    for (const g of pickerGroups('', undefined, all)) {
      for (const m of g.metrics) {
        expect(getMetric(m.id)?.category).toBe(g.category);
        expect(m.displayName).toBe(getMetric(m.id)?.displayName);
      }
    }
  });

  it('drops groups with no metric', () => {
    const groups = pickerGroups('hrv', undefined, all);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(g => g.metrics.length > 0)).toBe(true);
    expect(groups.length).toBeLessThan(getCategories().length);
  });

  it('finds a metric by alias', () => {
    expect(ids(pickerGroups('hrv', undefined, all))).toContain('heart_rate_variability');
    expect(ids(pickerGroups('  HRV ', undefined, all))).toContain('heart_rate_variability');
  });

  it('returns nothing when nothing matches', () => {
    expect(pickerGroups('zzzz-no-such-metric', undefined, all)).toEqual([]);
  });

  it('hides a metric only another source provides when it has no data', () => {
    expect(ids(pickerGroups('', undefined, () => false))).toContain('walking_heart_rate');
    expect(ids(pickerGroups('', ['oura'], () => false))).not.toContain('walking_heart_rate');
  });

  it('keeps a hidden-by-source metric once it has data', () => {
    expect(ids(pickerGroups('', ['oura'], id => id === 'walking_heart_rate'))).toContain('walking_heart_rate');
  });

  it('flags a metric without data and leaves the rest unflagged', () => {
    const groups = pickerGroups('', undefined, id => id === 'step_count');
    const flat = groups.flatMap(g => g.metrics);
    expect(flat.find(m => m.id === 'step_count')?.hasData).toBe(true);
    expect(flat.find(m => m.id === 'heart_rate_variability')?.hasData).toBe(false);
  });
});
