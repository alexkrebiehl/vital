import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { PoolLike } from '@/lib/db/pool';
import {
  DATA_SOURCES,
  activeHealthSources,
  activeSourceIds,
  defaultContext,
  sourceSetKey,
  type SourceContext,
} from './registry';

function ctx(env: Record<string, string>, opts: { credentials?: string[]; labs?: number } = {}): SourceContext {
  return {
    env: env as NodeJS.ProcessEnv,
    hasCredential: async id => (opts.credentials ?? []).includes(id),
    labReportCount: async () => opts.labs ?? 0,
  };
}

const HAE = { HAE_API_URL: 'http://hae.test', HAE_API_KEY: 'k' };
const OURA = {
  OURA_CLIENT_ID: 'id',
  OURA_CLIENT_SECRET: 'secret',
  OURA_REDIRECT_URI: 'http://localhost:8080/cb',
  VITAL_SECRET_KEY: randomBytes(32).toString('base64'),
};

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

  it('oura is inactive when the configuration is unusable, even with a credential row', async () => {
    const { OURA_CLIENT_SECRET: _s, ...noSecret } = OURA;
    expect(await activeSourceIds(ctx(noSecret, { credentials: ['oura'] }))).toEqual([]);
    expect(await activeSourceIds(ctx({ ...OURA, VITAL_SECRET_KEY: 'short' }, { credentials: ['oura'] }))).toEqual([]);
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

describe('defaultContext', () => {
  function client(answers: Record<string, Record<string, unknown>[]>): PoolLike & { sent: string[] } {
    const sent: string[] = [];
    return {
      sent,
      async query(text: string) {
        sent.push(text);
        const hit = Object.keys(answers).find(k => text.includes(k));
        return { rows: hit ? answers[hit] : [] };
      },
    };
  }

  it('reads credential existence and the lab count from the database, never a value', async () => {
    const db = client({ source_credentials: [{ present: 1 }], lab_reports: [{ n: 3 }] });
    const c = defaultContext({} as NodeJS.ProcessEnv, () => db);
    expect(await c.hasCredential('oura')).toBe(true);
    expect(await c.labReportCount()).toBe(3);
    expect(db.sent.join(' ')).not.toMatch(/ciphertext|lab_results/);
  });

  it('answers "none" when the database has nothing', async () => {
    const c = defaultContext({} as NodeJS.ProcessEnv, () => client({}));
    expect(await c.hasCredential('oura')).toBe(false);
    expect(await c.labReportCount()).toBe(0);
  });

  it('answers "none" when no database is configured', async () => {
    const c = defaultContext({} as NodeJS.ProcessEnv, () => null);
    expect(await c.hasCredential('oura')).toBe(false);
    expect(await c.labReportCount()).toBe(0);
  });
});
