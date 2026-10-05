import { describe, expect, it } from 'vitest';
import { formatEnergyPerWeight, formatPerWeightRange } from './format';

describe('body-goal formatting in the reader’s units', () => {
  it('states the energy in a unit of body weight per kg or per lb', () => {
    expect(formatEnergyPerWeight('metric')).toBe('7,700 kcal per kg');
    expect(formatEnergyPerWeight('imperial')).toBe('about 3,500 kcal per lb');
  });

  it('converts a g-per-kg range to g per lb', () => {
    expect(formatPerWeightRange({ min: 2, max: 2.7 }, 'metric')).toBe('2.0–2.7 g per kg');
    expect(formatPerWeightRange({ min: 2, max: 2.7 }, 'imperial')).toBe('0.91–1.22 g per lb');
  });
});
