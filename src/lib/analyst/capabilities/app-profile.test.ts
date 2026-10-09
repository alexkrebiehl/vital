// ── get_app_data: app.profile, app.preferences, app.briefing, app.dashboard ──
//
// The profile as context for reading the numbers (never the name or date of birth),
// units only, the briefing that is already written (never a new one), and the
// dashboard's cards without their values.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { briefingCacheStats, clearBriefingCache, peekBriefing, type BriefingModelTextLike } from '../../briefing';
import { awaitBriefingIdle, readBriefing } from '../../briefing';
import { defaultProfile } from '../../profile/types';
import { installBodyDataset } from './app.fake';
import { allReaders, BRIEFING, CARDS, PROFILE, prefsState, profileState } from './app-state.fake';
import { appCtxWith } from './app-ctx.fake';
import { HOST, NAME } from './app-status.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import { expectClean } from './test-context.fake';
import type { CapabilityContext } from './types';

beforeEach(() => void installBodyDataset());
afterEach(() => {
  resetToDemoDataset();
  clearBriefingCache();
});

const read = (id: string, args: Record<string, unknown> = {}, ctx: CapabilityContext = appCtxWith()): Promise<Envelope<unknown>> => capabilityById(id)!.read(args, ctx);
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;

describe('app.profile', () => {
  it('gives age, sex, timezone and the owner\'s notes, and nothing else', async () => {
    const env = await read('app.profile');
    expectClean(env);
    expect(data(env)).toEqual({ ageYears: 40, sex: 'female', timezone: 'America/Chicago', notes: PROFILE.notes, display: { ageYears: '40 years' } });
  });

  it('never carries the name, the date of birth, the briefing hour or the store\'s location', async () => {
    const text = JSON.stringify(await read('app.profile'));
    for (const secret of [NAME, 'Zaphod', 'Beeblebrox', '1986', '06-12', 'dateOfBirth', 'briefingHour', 'postgres', HOST]) expect(text).not.toContain(secret);
  });

  it('works out the age on the question\'s day, not today', async () => {
    const env = await read('app.profile', {}, appCtxWith(allReaders(), { refKey: '2026-06-11' }));
    expect(data(env).ageYears).toBe(39);
  });

  it('leaves out what is not set', async () => {
    const bare = profileState({ ...defaultProfile('UTC') });
    const env = await read('app.profile', {}, appCtxWith(allReaders({ profile: async () => bare })));
    expect(data(env)).toEqual({ timezone: 'UTC' });
  });

  it('says so when nothing has been saved, and is unavailable when the store cannot be read', async () => {
    const none = await read('app.profile', {}, appCtxWith(allReaders({ profile: async () => profileState(defaultProfile('UTC'), { stored: false }) })));
    expect(none).toMatchObject({ status: 'no_data_in_window', next: 'No profile details have been saved yet.' });
    const bad = await read('app.profile', {}, appCtxWith(allReaders({ profile: async () => profileState(defaultProfile('UTC'), { stored: false, error: `could not reach ${HOST}` }) })));
    expect(bad.status).toBe('source_unavailable');
    expect(JSON.stringify(bad)).not.toContain(HOST);
  });
});

describe('app.preferences', () => {
  it('gives the units and nothing else', async () => {
    const env = await read('app.preferences');
    expect(data(env)).toEqual({ units: 'imperial' });
    const text = JSON.stringify(env);
    for (const other of ['theme', 'notifications', 'dailyBriefing', 'revision', 'postgres']) expect(text).not.toContain(other);
  });

  it('is unavailable when the store cannot be read', async () => {
    const env = await read('app.preferences', {}, appCtxWith(allReaders({ preferences: async () => prefsState('metric', { stored: false, error: 'the database is down' }) })));
    expect(env.status).toBe('source_unavailable');
  });
});

describe('app.briefing', () => {
  it('gives the written text with the day it covers and who wrote it', async () => {
    const env = await read('app.briefing');
    expectClean(env);
    expect(data(env)).toMatchObject({ kind: 'model', headline: BRIEFING.headline, body: BRIEFING.body, recommendations: BRIEFING.recommendations, attribution: 'Written by test-model', coversDay: BRIEFING.coversDay });
  });

  it('leaves out the provider, the destination, the engine\'s own words and the bookkeeping', async () => {
    const text = JSON.stringify(await read('app.briefing'));
    for (const other of [HOST, 'a hosted provider label', 'engineDetail', 'destination', 'latencyMs', 'contextTokens', 'traceability']) expect(text).not.toContain(other);
  });

  it('says "No briefing has been written today yet." when there is none', async () => {
    const env = await read('app.briefing', {}, appCtxWith(allReaders({ briefing: () => null })));
    expect(env).toMatchObject({ status: 'no_data_in_window', next: 'No briefing has been written today yet.' });
  });

  it('reads the briefing for the question\'s own profile and goal and unit system', async () => {
    const seen: unknown[] = [];
    await read('app.briefing', {}, appCtxWith(allReaders({ briefing: deps => (seen.push(deps), null) }), { system: 'imperial' }));
    expect(seen[0]).toMatchObject({ system: 'imperial', profile: PROFILE });
  });

  it('never starts a briefing: with the real reader and a generator that throws, none runs and nothing is recorded', async () => {
    const generate = vi.fn(async (): Promise<BriefingModelTextLike> => {
      throw new Error('a generator ran');
    });
    const noGenerator = { ...allReaders(), briefing: (deps: Parameters<typeof peekBriefing>[0]) => peekBriefing({ ...deps, generate, env: {} as NodeJS.ProcessEnv, now: () => new Date('2026-09-18T13:00:00.000Z') }) };
    clearBriefingCache();
    const before = briefingCacheStats();
    const env = await read('app.briefing', {}, appCtxWith(noGenerator));
    await awaitBriefingIdle();
    expect(env.status).toBe('no_data_in_window');
    expect(generate).not.toHaveBeenCalled();
    expect(briefingCacheStats()).toEqual(before);

    // The page's own read WOULD have started one with the same inputs.
    readBriefing({ generate, env: {} as NodeJS.ProcessEnv, now: () => new Date('2026-09-18T13:00:00.000Z') });
    await awaitBriefingIdle();
    expect(generate).toHaveBeenCalled();
  });
});

describe('app.dashboard', () => {
  it('lists each card by its metric and date, with no value', async () => {
    const env = await read('app.dashboard');
    expectClean(env);
    const cards = data(env).cards as Record<string, any>[];
    expect(cards[0]).toEqual({ type: 'value', metric: 'Steps', metricId: 'step_count', date: 'yesterday' });
    expect(cards[1]).toMatchObject({ metricId: 'resting_heart_rate', date: '2026-09-01 to 2026-09-07' });
    expect(cards[2]).toEqual({ type: 'future', status: 'unreadable' });
    expect(JSON.stringify(env)).not.toMatch(new RegExp(`${HOST}|card-1|layout|revision`));
  });

  it('says so when there are no cards, and is unavailable without a store', async () => {
    const none = await read('app.dashboard', {}, appCtxWith(allReaders({ dashboard: async () => ({ mode: 'live', cards: [] }) })));
    expect(none).toMatchObject({ status: 'no_data_in_window', next: 'No dashboard cards are set up.' });
    const off = appCtxWith(allReaders({ dashboard: async () => null, databaseConfigured: () => false }));
    expect((await read('app.dashboard', {}, off)).status).toBe('source_unavailable');
    expect(await capabilityById('app.dashboard')!.coverage(off)).toMatchObject({ kind: 'unavailable' });
    expect(CARDS).toHaveLength(3);
  });
});
