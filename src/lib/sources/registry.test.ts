import { describe, expect, it } from 'vitest';
import { DATA_SOURCES, activeHealthSources, activeSourceIds, sourceSetKey, type SourceContext } from './registry';

function ctx(env: Record<string, string>, opts: { credentials?: string[]; labs?: number } = {}): SourceContext {
  return {
    env: env as NodeJS.ProcessEnv,
    hasCredential: async id => (opts.credentials ?? []).includes(id),
    labReportCount: async () => opts.labs ?? 0,
  };
}

const HAE = { HAE_API_URL: 'http://hae.test', HAE_API_KEY: 'k' };
const OURA = { OURA_CLIENT_ID: 'id' };

describe('source registry', () => {
  it('lists every source once, with a display name and a kind', () => {
    expect(DATA_SOURCES.map(s => s.id).sort()).toEqual(['hae', 'hevy', 'lab', 'oura']);
    for (const s of DATA_SOURCES) expect(s.displayName.length).toBeGreaterThan(0);
  });

  it('has nothing active in an empty environment', async () => {
    expect(await activeSourceIds(ctx({}))).toEqual([]);
    expect(await sourceSetKey(ctx({}))).toBe('');
  });

  it('hae needs both the URL and the key', async () => {
    expect(await activeSourceIds(ctx({ HAE_API_URL: 'http://hae.test' }))).toEqual([]);
    expect(await activeSourceIds(ctx({ HAE_API_KEY: 'k' }))).toEqual([]);
    expect(await activeSourceIds(ctx({ HAE_API_URL: ' ', HAE_API_KEY: 'k' }))).toEqual([]);
    expect(await activeSourceIds(ctx(HAE))).toEqual(['hae']);
  });

  it('oura needs configuration AND a stored credential', async () => {
    expect(await activeSourceIds(ctx(OURA))).toEqual([]);
    expect(await activeSourceIds(ctx({}, { credentials: ['oura'] }))).toEqual([]);
    expect(await activeSourceIds(ctx(OURA, { credentials: ['oura'] }))).toEqual(['oura']);
    expect(await activeSourceIds(ctx(OURA, { credentials: ['other'] }))).toEqual([]);
  });

  it('hevy is active when its API key is set', async () => {
    expect(await activeSourceIds(ctx({ HEVY_API_KEY: 'k' }))).toEqual(['hevy']);
    expect(await activeSourceIds(ctx({ HEVY_API_KEY: '  ' }))).toEqual([]);
  });

  it('lab is active only while at least one report exists', async () => {
    expect(await activeSourceIds(ctx({}, { labs: 0 }))).toEqual([]);
    expect(await activeSourceIds(ctx({}, { labs: 1 }))).toEqual(['lab']);
  });

  it('returns a sorted set and joins it with +', async () => {
    const all = ctx({ ...HAE, ...OURA, HEVY_API_KEY: 'k' }, { credentials: ['oura'], labs: 2 });
    expect(await activeSourceIds(all)).toEqual(['hae', 'hevy', 'lab', 'oura']);
    expect(await sourceSetKey(ctx({ ...HAE, ...OURA }, { credentials: ['oura'], labs: 1 }))).toBe('hae+lab+oura');
  });

  it('activeHealthSources keeps only health sources', async () => {
    const all = ctx({ ...HAE, ...OURA, HEVY_API_KEY: 'k' }, { credentials: ['oura'], labs: 2 });
    expect(await activeHealthSources(all)).toEqual(['hae', 'oura']);
    expect(await activeHealthSources(ctx({ HEVY_API_KEY: 'k' }, { labs: 1 }))).toEqual([]);
  });
});
