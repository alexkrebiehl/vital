import { describe, expect, it } from 'vitest';
import { isListed, listedMetrics } from './listed';

const none = () => false;

describe('isListed', () => {
  it('lists everything when the dataset does not say which sources it read', () => {
    expect(isListed('body_mass_index', undefined, none)).toBe(true);
    expect(isListed('body_mass_index', [], none)).toBe(true);
  });
  it('with only the ring, hides measures the ring cannot provide', () => {
    for (const id of ['heart_rate_variability', 'walking_heart_rate', 'apple_exercise_time', 'body_mass_index']) {
      expect(isListed(id, ['oura'], none)).toBe(false);
    }
  });
  it('with only the ring, lists what the ring provides even before it has a value', () => {
    for (const id of ['heart_rate', 'sleep_analysis', 'hrv_rmssd_sleep', 'step_count']) {
      expect(isListed(id, ['oura'], none)).toBe(true);
    }
  });
  it('with the export source, lists its measures and hides ring-only ones', () => {
    expect(isListed('body_mass_index', ['hae'], none)).toBe(true);
    expect(isListed('hrv_rmssd_sleep', ['hae'], none)).toBe(false);
  });
  it('always lists a metric that has data', () => {
    expect(isListed('hrv_rmssd_sleep', ['hae'], id => id === 'hrv_rmssd_sleep')).toBe(true);
  });
  it('lists the union with both sources', () => {
    expect(isListed('body_mass_index', ['hae', 'oura'], none)).toBe(true);
    expect(isListed('hrv_rmssd_sleep', ['hae', 'oura'], none)).toBe(true);
  });
  it('filters a list', () => {
    const ms = [{ id: 'body_mass_index' }, { id: 'heart_rate' }];
    expect(listedMetrics(ms, ['oura'], none).map(m => m.id)).toEqual(['heart_rate']);
  });
});
