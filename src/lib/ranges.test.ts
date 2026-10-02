import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_DAYS,
  RANGE_PRESET_DAYS,
  isCustomRange,
  isPresetRange,
  parseCustomDays,
  rangeDays,
  rangeValue,
} from './ranges';

describe('the shared range vocabulary', () => {
  it('offers exactly 7, 30 and 90 days as presets', () => {
    expect([...RANGE_PRESET_DAYS]).toEqual([7, 30, 90]);
  });

  it('writes and reads both formats', () => {
    expect(rangeValue(45)).toBe('45');
    expect(rangeValue(45, 'token')).toBe('45d');
    expect(rangeDays('45')).toBe(45);
    expect(rangeDays('45d', 'token')).toBe(45);
  });

  it('does not read a day count out of the wrong format or a non-count', () => {
    expect(rangeDays('45d')).toBeNull();
    expect(rangeDays('45', 'token')).toBeNull();
    expect(rangeDays('all')).toBeNull();
    expect(rangeDays('')).toBeNull();
    expect(rangeDays('0')).toBeNull();
    expect(rangeDays('-5')).toBeNull();
    expect(rangeDays('1.5')).toBeNull();
  });

  it('tells presets from custom ranges', () => {
    expect(isPresetRange('7')).toBe(true);
    expect(isPresetRange('90d', 'token')).toBe(true);
    expect(isCustomRange('45')).toBe(true);
    expect(isCustomRange('14d', 'token')).toBe(true);
    expect(isCustomRange('30')).toBe(false);
    expect(isCustomRange('all')).toBe(false);
  });
});

describe('parseCustomDays', () => {
  it('accepts whole days within bounds, tolerating spaces', () => {
    expect(parseCustomDays('45')).toEqual({ ok: true, days: 45 });
    expect(parseCustomDays(' 1 ')).toEqual({ ok: true, days: 1 });
    expect(parseCustomDays(String(MAX_CUSTOM_DAYS))).toEqual({ ok: true, days: MAX_CUSTOM_DAYS });
  });

  it.each(['', ' ', '0', '-3', '1.5', '3651', '99999999999999999999', 'abc', '30d', '1e3', '0x10'])(
    'rejects %j with a message that states the bounds',
    input => {
      const result = parseCustomDays(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain(`1 to ${MAX_CUSTOM_DAYS}`);
    }
  );
});
