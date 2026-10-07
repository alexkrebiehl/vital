import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentSourceKey,
  clearPurgersForTests,
  purgerNames,
  registerPurger,
  reconcileActiveSources,
  resetPurgeStateForTests,
} from '@/lib/sources/purge';
import type { SourceContext } from '@/lib/sources/registry';

function ctx(opts: { hae?: boolean; oura?: boolean; labs?: number } = {}): SourceContext {
  const env = {
    VITAL_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
  } as unknown as NodeJS.ProcessEnv;
  return {
    env,
    hasCredential: async id => (Boolean(opts.oura) && (id === 'oura' || id === 'oura-app')) || (Boolean(opts.hae) && id === 'hae'),
    labReportCount: async () => opts.labs ?? 0,
  };
}

describe('reconcileActiveSources', () => {
  // Only the test's own purgers: the app's are exercised below and elsewhere.
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });
  afterEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });

  it('stores the first set without purging anything', async () => {
    const purger = vi.fn();
    registerPurger('t', purger);
    const result = await reconcileActiveSources(ctx({ hae: true, oura: true }));
    expect(result).toMatchObject({ active: ['hae', 'oura'], removed: [], changed: true });
    expect(purger).not.toHaveBeenCalled();
    expect(currentSourceKey()).toBe('hae+oura');
  });

  it('runs every purger with the removed ids when a source disappears', async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerPurger('a', a);
    registerPurger('b', b);
    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    const result = await reconcileActiveSources(ctx({ hae: true, oura: false }));
    expect(result.removed).toEqual(['oura']);
    expect(a).toHaveBeenCalledWith(['oura']);
    expect(b).toHaveBeenCalledWith(['oura']);
    expect(currentSourceKey()).toBe('hae');
  });

  it('does nothing when the set is unchanged', async () => {
    const purger = vi.fn();
    registerPurger('t', purger);
    await reconcileActiveSources(ctx({ hae: true }));
    const again = await reconcileActiveSources(ctx({ hae: true }));
    expect(again.changed).toBe(false);
    expect(purger).not.toHaveBeenCalled();
  });

  it('reports an added source with no removed ids', async () => {
    const purger = vi.fn();
    registerPurger('t', purger);
    await reconcileActiveSources(ctx({ hae: true }));
    const result = await reconcileActiveSources(ctx({ hae: true, oura: true }));
    expect(result).toMatchObject({ added: ['oura'], removed: [], changed: true });
    expect(purger).toHaveBeenCalledWith([]);
  });

  it('keeps going past a purger that throws, and retries it at the next call', async () => {
    const good = vi.fn();
    let broken = true;
    registerPurger('bad', () => {
      if (broken) throw new Error('holds Oura Ring data in its message');
    });
    registerPurger('good', good);
    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    const first = await reconcileActiveSources(ctx({ hae: true }));
    expect(first.failed).toEqual(['bad']);
    expect(JSON.stringify(first)).not.toContain('Oura Ring');
    expect(good).toHaveBeenCalledTimes(1);
    // The new set is not published while data may remain.
    expect(currentSourceKey()).toBe('hae+oura');
    broken = false;
    const second = await reconcileActiveSources(ctx({ hae: true }));
    expect(second.failed).toEqual([]);
    expect(currentSourceKey()).toBe('hae');
  });

  it('does not treat a registry failure as a removal', async () => {
    const purger = vi.fn();
    registerPurger('t', purger);
    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    const failing: SourceContext = {
      ...ctx({ hae: true }),
      hasCredential: async () => {
        throw new Error('connection refused');
      },
    };
    await expect(reconcileActiveSources(failing)).rejects.toThrow();
    expect(purger).not.toHaveBeenCalled();
    expect(currentSourceKey()).toBe('hae+oura');
  });

  it('shares one pass between concurrent callers', async () => {
    const purger = vi.fn();
    registerPurger('t', purger);
    let reads = 0;
    const counting: SourceContext = {
      ...ctx({ hae: true }),
      hasCredential: async () => {
        reads += 1;
        return false;
      },
    };
    await Promise.all([reconcileActiveSources(counting), reconcileActiveSources(counting)]);
    expect(reads).toBe(3); // one pass: a lookup for each credentialed source (oura stops at its first miss)
  });

  it('keeps two functions registered under one name (one per server bundle)', async () => {
    const one = vi.fn();
    const two = vi.fn();
    registerPurger('dup', one);
    registerPurger('dup', two);
    registerPurger('dup', two);
    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    await reconcileActiveSources(ctx({ hae: true }));
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });
});

describe('purgers registered by the in-memory holders', () => {
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
    // Fresh copies of every holder, so each registers into the cleared registry.
    vi.resetModules();
  });
  afterEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });

  it('every cache that can hold source data registers one', async () => {
    await import('@/lib/adapters/cache');
    await import('@/lib/briefing/index');
    await import('@/lib/workout-sources/store');
    await import('@/lib/activity-maps/routes');
    await import('@/lib/activity-maps/service');
    await import('@/lib/routine/narrative');
    await import('@/lib/adapters/oura/index');
    expect(purgerNames()).toEqual(
      [
        'activity-maps.coverage',
        'activity-maps.routes',
        'adapters.cache',
        'briefing',
        'oura.last-outcome',
        'routine.narrative',
        'workout-sources.store',
      ].sort()
    );
  });

  it('the live cache purger drops live-dataset and oura entries and nothing else', async () => {
    const { liveCache: cache } = await import('@/lib/adapters/cache');
    await cache.getOrLoad('live-dataset:UTC:400:hae+oura', async () => ({ a: 1 }));
    await cache.getOrLoad('oura:UTC:400', async () => ({ b: 1 }));
    await cache.getOrLoad('unrelated', async () => ({ c: 1 }));
    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    await reconcileActiveSources(ctx({ hae: true }));
    expect(cache.stats().keys).toEqual(['unrelated']);
  });
});

describe('what each purger removes', () => {
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
    vi.resetModules();
  });
  afterEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });

  it('a briefing written from HAE and Oura is never shown once Oura is gone', async () => {
    const briefing = await import('@/lib/briefing/index');
    const { briefingSchedule } = await import('@/lib/briefing/schedule');
    const { defaultProfile } = await import('@/lib/profile/types');
    const profile = defaultProfile();
    const schedule = briefingSchedule(profile, new Date('2026-09-17T18:00:00Z'));

    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    const withOura = briefing.briefingCacheKey(schedule, 'metric', profile);
    expect(withOura).toContain(':hae+oura');

    // A model-written briefing for that day, from the two sources.
    const generate = async () => ({
      headline: 'h',
      body: 'b',
      recommendations: [],
      model: 'm',
      latencyMs: 1,
      traceability: { checked: 0, unmatched: [] },
      adjustments: [],
    });
    const deps = { profile, now: () => new Date('2026-09-17T18:00:00Z'), generate };
    briefing.readBriefing(deps);
    await briefing.awaitBriefingIdle();
    expect(briefing.briefingCacheStats().keys).toContain(withOura);

    await reconcileActiveSources(ctx({ hae: true }));
    expect(briefing.briefingCacheStats().keys).toEqual([]);
    expect(briefing.briefingCacheKey(schedule, 'metric', profile)).toContain(':hae');
    expect(briefing.briefingCacheKey(schedule, 'metric', profile)).not.toBe(withOura);
    // The day is not marked as already attempted: it is written again from what remains.
    expect(briefing.hasBriefingAttempt(withOura)).toBe(false);
  });

  it('drops a removed workout source\'s sessions and keeps the others', async () => {
    const store = await import('@/lib/workout-sources/store');
    const env = { VITAL_DATA_MODE: 'live' } as unknown as NodeJS.ProcessEnv;
    const hevyStored = { state: 'ok', apiKey: 'hevy-key-for-tests', url: '' } as const;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body =
        url.pathname === '/v1/workouts'
          ? {
              page: 1,
              page_count: 1,
              workouts: [
                {
                  id: 'one',
                  title: 'Upper',
                  start_time: '2026-09-17T23:00:00Z',
                  end_time: '2026-09-17T23:30:00Z',
                  exercises: [{ title: 'Push Up', exercise_template_id: 'P', sets: [{ index: 0, type: 'normal', reps: 10 }] }],
                },
              ],
            }
          : { page: 1, page_count: 1, exercise_templates: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;
    const now = () => Date.parse('2026-09-18T12:00:00Z');

    expect((await store.loadTrainingData({ env, fetchImpl, now, hevyStored })).sessions).toHaveLength(1);
    expect((await store.heldSourceStatuses({ env, hevyStored }))[0].sessions).toBe(1);

    store.purgeTrainingSources(['oura']); // not a workout source: nothing changes
    expect((await store.heldSourceStatuses({ env, hevyStored }))[0].sessions).toBe(1);

    store.purgeTrainingSources(['hevy']);
    expect((await store.heldSourceStatuses({ env, hevyStored }))[0]).toMatchObject({ sessions: 0, lastSyncAt: null, lastError: null });
    store.resetTrainingStoreForTests();
  });

  it('drops every held route, and the maps built from them, when HAE is removed', async () => {
    const routes = await import('@/lib/activity-maps/routes');
    const env = {} as unknown as NodeJS.ProcessEnv;
    const haeConfig = (await import('@/lib/adapters/hae')).buildHaeConfig('http://hae.test', 'sample-key', env);
    const workout = {
      id: 'a',
      workout_type: 'Outdoor Walk',
      start_time: '2026-09-01T12:00:00Z',
      end_time: '2026-09-01T13:00:00Z',
      duration_minutes: 60,
      calories_burned: 200,
      source: 'Sample\'s Apple Watch',
    };
    const detail = {
      route: [
        { latitude: 40, longitude: -80, time: '2026-09-01T12:00:01Z' },
        { latitude: 40.0001, longitude: -80, time: '2026-09-01T12:00:02Z' },
      ],
      heartRateData: [{ timestamp: '2026-09-01T12:00:00Z', value: 110 }],
    };
    const fetchImpl = (async () => new Response(JSON.stringify(detail), { status: 200 })) as unknown as typeof fetch;
    await routes.loadRoutes([workout], 'live', { env, haeConfig, fetchImpl });
    expect(routes.routeStoreStats().workouts).toBe(1);
    const before = (await routes.loadRoutes([workout], 'live', { env, haeConfig, fetchImpl })).generation;

    await reconcileActiveSources(ctx({ hae: true, oura: true }));
    await reconcileActiveSources(ctx({ hae: true })); // Oura goes: routes are HAE's, they stay
    expect(routes.routeStoreStats().workouts).toBe(1);

    await reconcileActiveSources(ctx({ oura: true }));
    expect(routes.routeStoreStats()).toEqual({ workouts: 0, withRoute: 0, points: 0, bytes: 0 });
    const after = (await routes.loadRoutes([], 'live', { env, haeConfig, fetchImpl })).generation;
    expect(after).toBeGreaterThan(before);
    routes.clearRouteStore();
  });
});
