// ── Blood pressure is printed as a pair, through the registry formatter ─────

import { describe, expect, it } from 'vitest';
import {
  formatBloodPressure,
  formatBloodPressureBreakdown,
  formatBloodPressureChange,
} from '@/lib/metrics/format';

describe('formatBloodPressure', () => {
  it("prints the owner's example as 111/71 mmHg", () => {
    expect(formatBloodPressure(111, 71)).toBe('111/71 mmHg');
  });

  it('rounds a mean through the registry formatter (whole mmHg)', () => {
    expect(formatBloodPressure(111.6, 71.4)).toBe('112/71 mmHg');
  });

  it('shows a dash rather than a zero for a missing number', () => {
    expect(formatBloodPressure(Number.NaN, 71)).toBe('—');
    expect(formatBloodPressure(111, Number.NaN)).toBe('—');
  });
});

describe('formatBloodPressureBreakdown', () => {
  it('names each number so the pair can be read at a glance', () => {
    expect(formatBloodPressureBreakdown(111, 71)).toBe('Systolic 111 · Diastolic 71');
  });
});

describe('formatBloodPressureChange', () => {
  it('signs each series separately', () => {
    expect(formatBloodPressureChange(2, -1)).toBe('+2/-1 mmHg');
  });

  it('prints a real zero as 0, and no change when both are zero', () => {
    expect(formatBloodPressureChange(3, 0)).toBe('+3/0 mmHg');
    expect(formatBloodPressureChange(0, 0)).toBe('no change');
  });

  it('shows a dash when a change could not be computed', () => {
    expect(formatBloodPressureChange(Number.NaN, 1)).toBe('—');
  });
});
