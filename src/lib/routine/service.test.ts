import { describe, expect, it } from 'vitest';
import { heldSourceStatuses, resetTrainingStoreForTests } from '../workout-sources/store';
import { hasExerciseData } from './service';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('hasExerciseData', () => {
  it('is false in live mode with no workout source configured', () => {
    resetTrainingStoreForTests();
    const statuses = heldSourceStatuses(env({ VITAL_DATA_MODE: 'live' }));
    expect(hasExerciseData({ origin: 'live', sessions: [], statuses })).toBe(false);
  });

  it('is true once a source is configured, even before it has synced', () => {
    resetTrainingStoreForTests();
    const statuses = heldSourceStatuses(env({ VITAL_DATA_MODE: 'live', HEVY_API_KEY: 'hevy-key-for-tests' }));
    expect(hasExerciseData({ origin: 'live', sessions: [], statuses })).toBe(true);
  });

  it('is true in demo mode, which serves committed training sessions', () => {
    expect(hasExerciseData({ origin: 'demo', sessions: [], statuses: heldSourceStatuses(env({})) })).toBe(true);
  });
});
