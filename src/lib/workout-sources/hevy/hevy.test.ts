import { describe, expect, it } from 'vitest';
import {
  HEVY_RATE_LIMIT_RETRIES,
  HevyError,
  fetchWorkoutsSince,
  hevyGet,
  readHevyConfig,
  type HevyWireWorkout,
} from './client';
import { hevyPlugin, syncHevy } from './index';
import { loadMeaningFor, normalizeWorkout } from './normalize';

const KEY = 'hevy-secret-key-do-not-log';
const ENV = { HEVY_API_KEY: KEY } as unknown as NodeJS.ProcessEnv;
const CONFIG = readHevyConfig(ENV)!;
const NOW = Date.parse('2026-09-18T12:00:00Z');
const noSleep = async () => {};

function wireWorkout(id: string, start: string, reps: number[] = [10, 10, 8]): HevyWireWorkout {
  return {
    id,
    title: 'Upper',
    start_time: start,
    end_time: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    exercises: [
      {
        index: 0,
        title: 'Decline Push Up',
        exercise_template_id: 'T-DECLINE',
        sets: reps.map((r, i) => ({ index: i, type: 'normal', reps: r, weight_kg: null, rpe: 8 + i * 0.5 })),
      },
    ],
  };
}

interface Route {
  match: RegExp;
  respond: (url: URL) => { status?: number; body: unknown };
}

function fakeFetch(routes: Route[]) {
  const calls: { url: string; key: string | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: url.pathname + url.search, key: headers['api-key'] });
    const route = routes.find(r => r.match.test(url.pathname));
    const { status = 200, body } = route ? route.respond(url) : { status: 404, body: { error: 'nope' } };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 23 workouts, one every 3 days, newest first, served 10 per page. */
function pagedWorkouts(count = 23) {
  const all = Array.from({ length: count }, (_, i) =>
    wireWorkout(`w${i}`, new Date(NOW - (i * 3 + 1) * 86_400_000).toISOString())
  );
  return {
    all,
    route: {
      match: /^\/v1\/workouts$/,
      respond: (url: URL) => {
        const page = Number(url.searchParams.get('page'));
        const size = Number(url.searchParams.get('pageSize'));
        return {
          body: {
            page,
            page_count: Math.ceil(all.length / size),
            workouts: all.slice((page - 1) * size, page * size),
          },
        };
      },
    } satisfies Route,
  };
}

const TEMPLATES_ROUTE: Route = {
  match: /^\/v1\/exercise_templates$/,
  respond: () => ({
    body: {
      page: 1,
      page_count: 1,
      exercise_templates: [
        { id: 'T-DECLINE', title: 'Decline Push Up', type: 'reps_only', primary_muscle_group: 'chest', is_custom: false },
        { id: 'T-ASSIST', title: 'Pull Up (Assisted)', type: 'bodyweight_assisted_reps', primary_muscle_group: 'lats' },
      ],
    },
  }),
};

describe('readHevyConfig', () => {
  it('is null without a key and defaults the host', () => {
    expect(readHevyConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(CONFIG.baseUrl).toBe('https://api.hevyapp.com');
    expect(CONFIG.ttlSeconds).toBe(300);
  });
});

describe('hevyGet', () => {
  it('sends the key only as the api-key header', async () => {
    const { impl, calls } = fakeFetch([{ match: /user/, respond: () => ({ body: { data: {} } }) }]);
    await hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl });
    expect(calls[0].key).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
  });

  it('retries a 429 a bounded number of times, then reports it', async () => {
    const { impl, calls } = fakeFetch([{ match: /user/, respond: () => ({ status: 429, body: {} }) }]);
    await expect(hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl, sleep: noSleep })).rejects.toMatchObject({
      kind: 'rate_limited',
    });
    expect(calls).toHaveLength(HEVY_RATE_LIMIT_RETRIES + 1);
  });

  it('recovers when a retry succeeds', async () => {
    let n = 0;
    const { impl } = fakeFetch([
      { match: /user/, respond: () => (n++ === 0 ? { status: 429, body: {} } : { body: { ok: true } }) },
    ]);
    await expect(hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl, sleep: noSleep })).resolves.toEqual({ ok: true });
  });

  it('names a rejected key and never echoes it', async () => {
    const { impl } = fakeFetch([{ match: /user/, respond: () => ({ status: 401, body: { error: `bad key ${KEY}` } }) }]);
    const error = (await hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl }).catch(e => e)) as HevyError;
    expect(error).toBeInstanceOf(HevyError);
    expect(error.kind).toBe('unauthorized');
    expect(error.message).not.toContain(KEY);
  });

  it('scrubs the key out of an echoed error body', async () => {
    const { impl } = fakeFetch([{ match: /user/, respond: () => ({ status: 500, body: { error: `boom ${KEY}` } }) }]);
    const error = (await hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl }).catch(e => e)) as HevyError;
    expect(error.kind).toBe('http_error');
    expect(error.message).not.toContain(KEY);
  });

  it('rejects a body that is not an object', async () => {
    const { impl } = fakeFetch([{ match: /user/, respond: () => ({ body: [1, 2] }) }]);
    await expect(hevyGet(CONFIG, '/v1/user/info', { fetchImpl: impl })).rejects.toMatchObject({ kind: 'invalid_payload' });
  });
});

describe('fetchWorkoutsSince', () => {
  it('pages newest-first and stops at the cut-off', async () => {
    const { all, route } = pagedWorkouts();
    const { impl, calls } = fakeFetch([route]);
    // A 30-day window holds w0…w9 (days 1…28); w10 is day 31.
    const since = new Date(NOW - 30 * 86_400_000).toISOString();
    const got = await fetchWorkoutsSince(CONFIG, since, { fetchImpl: impl });
    expect(got.map(w => w.id)).toEqual(all.slice(0, 10).map(w => w.id));
    // Page 1 is entirely inside the window, so page 2 had to be read to find the edge.
    expect(calls).toHaveLength(2);
  });

  it('reads every page when the whole history is inside the window', async () => {
    const { route } = pagedWorkouts();
    const { impl, calls } = fakeFetch([route]);
    const got = await fetchWorkoutsSince(CONFIG, new Date(NOW - 400 * 86_400_000).toISOString(), { fetchImpl: impl });
    expect(got).toHaveLength(23);
    expect(calls).toHaveLength(3);
  });

  it('rejects a page without a workouts array', async () => {
    const { impl } = fakeFetch([{ match: /^\/v1\/workouts$/, respond: () => ({ body: { page: 1, page_count: 1 } }) }]);
    await expect(fetchWorkoutsSince(CONFIG, new Date(0).toISOString(), { fetchImpl: impl })).rejects.toMatchObject({
      kind: 'invalid_payload',
    });
  });
});

describe('normalizeWorkout', () => {
  it('maps sets, keeps missing numbers missing and prefixes the id', () => {
    const s = normalizeWorkout(wireWorkout('abc', '2026-09-17T23:10:00Z'), {
      'T-DECLINE': {
        sourceId: 'hevy', id: 'T-DECLINE', name: 'Decline Push Up', kind: 'reps_only',
        loadMeaning: 'none', primaryMuscle: 'chest', custom: false,
      },
    })!;
    expect(s.id).toBe('hevy:abc');
    expect(s.exercises[0]).toMatchObject({ name: 'Decline Push Up', loadMeaning: 'none', primaryMuscle: 'chest' });
    expect(s.exercises[0].sets[0]).toEqual({ index: 0, kind: 'normal', reps: 10, rpe: 8 });
    expect('weightKg' in s.exercises[0].sets[0]).toBe(false);
  });

  it('drops a workout with no id or no start', () => {
    expect(normalizeWorkout({ ...wireWorkout('x', '2026-09-01T00:00:00Z'), id: undefined })).toBeNull();
    expect(normalizeWorkout({ ...wireWorkout('x', '2026-09-01T00:00:00Z'), start_time: 'nonsense' })).toBeNull();
  });

  it('reads assistance from the exercise type, or the name when the catalogue is missing', () => {
    expect(loadMeaningFor('bodyweight_assisted_reps')).toBe('assistance');
    expect(loadMeaningFor('weight_reps')).toBe('added');
    expect(loadMeaningFor('duration')).toBe('none');
    expect(loadMeaningFor(undefined, 'Pull Up (Assisted)')).toBe('assistance');
  });
});

describe('syncHevy', () => {
  it('backfills the lookback window and reads the catalogue on the first sync', async () => {
    const { route } = pagedWorkouts();
    const { impl } = fakeFetch([route, TEMPLATES_ROUTE]);
    const result = await syncHevy(CONFIG, null, 30, { fetchImpl: impl, now: () => NOW });
    expect(result.mode).toBe('full');
    expect(Object.keys(result.state.sessions)).toHaveLength(10);
    expect(result.state.templates?.['T-ASSIST']?.loadMeaning).toBe('assistance');
    expect(result.state.syncedAt).toBe(new Date(NOW).toISOString());
    expect(Object.values(result.state.sessions)[0].exercises[0].primaryMuscle).toBe('chest');
  });

  it('applies update and delete events incrementally, newest state winning', async () => {
    const { route } = pagedWorkouts();
    const first = await syncHevy(CONFIG, null, 30, { fetchImpl: fakeFetch([route, TEMPLATES_ROUTE]).impl, now: () => NOW });

    const later = NOW + 86_400_000;
    const events = [
      // Newest first, as Hevy returns them.
      { type: 'updated', workout: wireWorkout('w0', new Date(NOW - 86_400_000).toISOString(), [12, 12, 12]) },
      { type: 'updated', workout: wireWorkout('new', new Date(later - 3600_000).toISOString()) },
      { type: 'deleted', id: 'w1' },
      { type: 'updated', workout: wireWorkout('w0', new Date(NOW - 86_400_000).toISOString(), [1, 1, 1]) },
    ];
    const { impl, calls } = fakeFetch([
      {
        match: /^\/v1\/workouts\/events$/,
        respond: () => ({ body: { page: 1, page_count: 1, events } }),
      },
    ]);
    const second = await syncHevy(CONFIG, first.state, 30, { fetchImpl: impl, now: () => later });
    expect(second.mode).toBe('incremental');
    expect(calls.every(c => c.url.startsWith('/v1/workouts/events'))).toBe(true);
    // `since` overlaps the previous sync start.
    expect(decodeURIComponent(calls[0].url)).toContain(`since=${new Date(NOW - 5 * 60_000).toISOString()}`);
    const ids = Object.keys(second.state.sessions);
    expect(ids).toContain('hevy:new');
    expect(ids).not.toContain('hevy:w1');
    expect(second.state.sessions['hevy:w0'].exercises[0].sets.map(s => s.reps)).toEqual([12, 12, 12]);
  });

  it('prunes sessions that fell out of the lookback window', async () => {
    const { route } = pagedWorkouts();
    const first = await syncHevy(CONFIG, null, 30, { fetchImpl: fakeFetch([route, TEMPLATES_ROUTE]).impl, now: () => NOW });
    const { impl } = fakeFetch([
      { match: /^\/v1\/workouts\/events$/, respond: () => ({ body: { page: 1, page_count: 0, events: [] } }) },
    ]);
    const later = NOW + 10 * 86_400_000;
    const second = await syncHevy(CONFIG, first.state, 30, { fetchImpl: impl, now: () => later });
    const cutoff = later - 30 * 86_400_000;
    expect(Object.values(second.state.sessions).every(s => Date.parse(s.startTime) >= cutoff)).toBe(true);
    expect(Object.keys(second.state.sessions).length).toBeLessThan(10);
  });
});

describe('hevyPlugin.probe', () => {
  it('reports a failing key without throwing', async () => {
    const { impl } = fakeFetch([{ match: /user/, respond: () => ({ status: 401, body: {} }) }]);
    const result = await hevyPlugin.probe(CONFIG, { fetchImpl: impl });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
  });
});
