import { describe, expect, it } from 'vitest';
import { heldSourceStatuses, resetTrainingStoreForTests } from '../workout-sources/store';
import { hasExerciseData } from './service';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('hasExerciseData', () => {
  it('is false in live mode with no workout source configured', async () => {
    resetTrainingStoreForTests();
    const statuses = await heldSourceStatuses({ env: env({ VITAL_DATA_MODE: 'live' }), hevyStored: { state: 'none' } });
    expect(hasExerciseData({ origin: 'live', sessions: [], statuses })).toBe(false);
  });

  it('is true once a source is configured, even before it has synced', async () => {
    resetTrainingStoreForTests();
    const statuses = await heldSourceStatuses({
      env: env({ VITAL_DATA_MODE: 'live' }),
      hevyStored: { state: 'ok', apiKey: 'hevy-key-for-tests', url: '' },
    });
    expect(hasExerciseData({ origin: 'live', sessions: [], statuses })).toBe(true);
  });

  it('is true in demo mode, which serves committed training sessions', async () => {
    expect(hasExerciseData({ origin: 'demo', sessions: [], statuses: await heldSourceStatuses({ env: env({}) }) })).toBe(true);
  });
});
