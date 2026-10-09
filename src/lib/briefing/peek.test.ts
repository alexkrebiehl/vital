// ── Reading the written briefing without starting one ───────────────────────
//
// peekBriefing is what the analyst reads: the briefing already written for the
// current day, or nothing. It must never reach a model, count as a page view, or
// record an attempt (the AI-connection contract: one connection per explicit request
// plus the briefing itself).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import {
  awaitBriefingIdle,
  briefingCacheKey,
  briefingCacheStats,
  briefingSchedule,
  clearBriefingCache,
  hasBriefingAttempt,
  peekBriefing,
  readBriefing,
  type BriefingModelTextLike,
} from '@/lib/briefing';
import { resetBriefingEngineMemo } from '@/lib/briefing/engine';
import { defaultProfile, type VitalProfile } from '@/lib/profile/types';

const PROFILE: VitalProfile = { ...defaultProfile('UTC'), briefingHour: 6 };
const MIDDAY = () => new Date('2026-09-18T13:00:00.000Z');
const NO_ENV = {} as unknown as NodeJS.ProcessEnv;
const deps = (over: Record<string, unknown> = {}) => ({ env: NO_ENV, profile: PROFILE, now: MIDDAY, ...over });
const key = () => briefingCacheKey(briefingSchedule(PROFILE, MIDDAY()), 'metric', PROFILE, null);

const WRITTEN: BriefingModelTextLike = {
  headline: 'A steady week.',
  body: 'Nothing moved far from your own baseline.',
  recommendations: ['Keep your bedtime steady.'],
  model: 'test-model',
  latencyMs: 5,
  traceability: { checked: 0, unmatched: [] },
  adjustments: [],
};
const thrower = () => vi.fn(async (): Promise<BriefingModelTextLike> => {
  throw new Error('a generator ran');
});

beforeEach(() => {
  clearBriefingCache();
  resetBriefingEngineMemo();
  resetToDemoDataset();
});
afterEach(() => {
  clearBriefingCache();
  resetBriefingEngineMemo();
});

describe('peekBriefing', () => {
  it('returns null on a cold read, and starts, counts and records nothing', () => {
    const generate = thrower();
    const before = briefingCacheStats();
    expect(peekBriefing(deps({ generate }))).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(briefingCacheStats()).toEqual(before);
    expect(hasBriefingAttempt(key())).toBe(false);
  });

  it('where readBriefing would have started one, which is why the analyst does not call it', async () => {
    const generate = vi.fn(async () => WRITTEN);
    readBriefing(deps({ generate }));
    await awaitBriefingIdle();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(hasBriefingAttempt(key())).toBe(true);
  });

  it('returns the written briefing once there is one, without calling a generator', async () => {
    readBriefing(deps({ generate: async () => WRITTEN }));
    await awaitBriefingIdle();
    const before = briefingCacheStats();
    const generate = thrower();
    const view = peekBriefing(deps({ generate }));
    expect(view).toMatchObject({ kind: 'model', headline: 'A steady week.', coversDay: '2026-09-18', cached: true });
    expect(generate).not.toHaveBeenCalled();
    expect(briefingCacheStats()).toEqual(before);
  });
});
