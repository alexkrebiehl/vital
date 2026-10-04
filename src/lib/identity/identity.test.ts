// ── Profiles, the per-person environment and the request scope ──────────────

import { describe, expect, it, vi } from 'vitest';
import {
  declaredProfiles,
  effectiveVarName,
  profileEnv,
  profileVarName,
  profilesDeclared,
} from './profiles';
import { configVarName, runAsUser } from './scope';
import { serverEnv } from './env';
import { profileForRequest } from './index';
import { syncUsers } from '@/lib/db/users-store';
import {
  FIXTURES,
  activeDataset,
  dataMode,
  referenceDayKey,
  setActiveDataset,
} from '@/lib/adapters/dataset';
import type { HealthFixtures } from '@/lib/metrics/types';
import type { Identity } from './types';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

/** An environment with just these variables (Next types NODE_ENV as required). */
function envOf(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

function identity(slug: string, primary = false, env: NodeJS.ProcessEnv = envOf()): Identity {
  return { slug, primary, userId: `id-${slug}`, userError: null, env };
}

describe('declared profiles', () => {
  it('is one implicit `owner` profile when VITAL_PROFILES is unset', () => {
    expect(profilesDeclared(envOf())).toBe(false);
    expect(declaredProfiles(envOf())).toEqual([{ slug: 'owner', primary: true }]);
  });

  it('lists the declared slugs, primary first, skipping invalid and repeated ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(declaredProfiles(envOf({ VITAL_PROFILES: ' Alex, sam,9lives,alex, mary-jo ' }))).toEqual([
      { slug: 'alex', primary: true },
      { slug: 'sam', primary: false },
      { slug: 'mary-jo', primary: false },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('names a profile variable with the slug upper-cased and hyphens as underscores', () => {
    expect(profileVarName('mary-jo', 'HAE_API_KEY')).toBe('VITAL_PROFILE_MARY_JO_HAE_API_KEY');
  });
});

describe('the per-person environment', () => {
  const env = envOf({
    VITAL_PROFILES: 'alex,sam',
    HAE_API_URL: 'http://alex-export',
    HAE_API_KEY: 'alex-key',
    HEVY_API_KEY: 'alex-hevy',
    VITAL_DATA_MODE: 'live',
    ANALYST_PROVIDER: 'openai',
    VITAL_PROFILE_SAM_HAE_API_URL: 'http://sam-export',
    VITAL_PROFILE_SAM_HAE_API_KEY: 'sam-key',
  });

  it('lets the primary profile keep the unprefixed variables', () => {
    const alex = profileEnv({ slug: 'alex', primary: true }, env);
    expect(alex.HAE_API_URL).toBe('http://alex-export');
    expect(alex.HEVY_API_KEY).toBe('alex-hevy');
  });

  it('never hands another profile the primary person’s credentials', () => {
    const sam = profileEnv({ slug: 'sam', primary: false }, env);
    expect(sam.HAE_API_URL).toBe('http://sam-export');
    expect(sam.HAE_API_KEY).toBe('sam-key');
    expect(sam.HEVY_API_KEY).toBeUndefined();
    // Sam's data mode is not inherited either: without their own, it is demo.
    expect(sam.VITAL_DATA_MODE).toBeUndefined();
    // Deployment-wide configuration is shared.
    expect(sam.ANALYST_PROVIDER).toBe('openai');
  });

  it('lets a prefixed variable override the plain one for the primary profile too', () => {
    const alex = profileEnv({ slug: 'alex', primary: true }, { ...env, VITAL_PROFILE_ALEX_HAE_API_KEY: 'override' });
    expect(alex.HAE_API_KEY).toBe('override');
  });

  it('names the variable a person should set', () => {
    expect(effectiveVarName({ slug: 'alex', primary: true }, 'HAE_API_KEY', env)).toBe('HAE_API_KEY');
    expect(effectiveVarName({ slug: 'sam', primary: false }, 'HEVY_API_KEY', env)).toBe('VITAL_PROFILE_SAM_HEVY_API_KEY');
    runAsUser(identity('sam'), () => {
      expect(configVarName('HEVY_API_KEY', env)).toBe('VITAL_PROFILE_SAM_HEVY_API_KEY');
      expect(configVarName('ANALYST_API_KEY', env)).toBe('ANALYST_API_KEY');
    });
    // A single-profile deployment always names the plain variable.
    runAsUser(identity('owner', true), () => {
      expect(configVarName('HAE_API_KEY', envOf())).toBe('HAE_API_KEY');
    });
  });

  it('is what serverEnv() answers inside a scope', () => {
    const own = envOf({ HAE_API_URL: 'http://scoped' });
    runAsUser(identity('sam', false, own), () => {
      expect(serverEnv()).toBe(own);
    });
  });
});

describe('the profile a request is for', () => {
  const env = envOf({ VITAL_PROFILES: 'alex,sam' });
  const request = (cookie?: string) => ({ cookie: () => cookie, header: () => null });

  it('follows the switcher cookie to a declared profile', () => {
    expect(profileForRequest(request('sam'), env).slug).toBe('sam');
  });

  it('falls back to the primary profile for a missing or unknown cookie', () => {
    expect(profileForRequest(request(), env).slug).toBe('alex');
    expect(profileForRequest(request('mallory'), env).slug).toBe('alex');
  });

  it('refuses an identity provider that does not exist yet', () => {
    expect(() => profileForRequest(request(), envOf({ VITAL_PROFILES: 'alex,sam', VITAL_AUTH: 'oidc' }))).toThrow(/not supported/);
  });
});

describe('users rows for the declared profiles', () => {
  /** A tiny `users` table with the store's three statements. */
  function fakeUsers(initial: string[]) {
    const rows = initial.map((slug, i) => ({ id: `u${i}`, slug }));
    let next = rows.length;
    return {
      rows,
      async query(text: string, params: unknown[] = []) {
        if (text.includes('UPDATE users')) {
          const [to, from] = params as [string, string];
          if (!rows.some(r => r.slug === to)) for (const r of rows) if (r.slug === from) r.slug = to;
          return { rows: [] };
        }
        if (text.includes('INSERT INTO users')) {
          for (const slug of params[0] as string[]) if (!rows.some(r => r.slug === slug)) rows.push({ id: `u${next++}`, slug });
          return { rows: [] };
        }
        return { rows: rows.filter(r => (params[0] as string[]).includes(r.slug)) };
      },
    };
  }

  it('gives the pre-profiles owner data to the primary profile', async () => {
    const db = fakeUsers(['owner']);
    const ids = await syncUsers(db, [
      { slug: 'alex', primary: true },
      { slug: 'sam', primary: false },
    ]);
    expect(ids.get('alex')).toBe('u0');
    expect(ids.get('sam')).toBe('u1');
    expect(db.rows.map(r => r.slug)).toEqual(['alex', 'sam']);
  });

  it('keeps `owner` when it is itself declared, and is idempotent', async () => {
    const db = fakeUsers(['owner']);
    await syncUsers(db, [{ slug: 'owner', primary: true }]);
    const ids = await syncUsers(db, [{ slug: 'owner', primary: true }]);
    expect(ids.get('owner')).toBe('u0');
    expect(db.rows).toHaveLength(1);
  });
});

describe('the request scope keeps each person’s dataset apart', () => {
  function datasetFor(referenceDate: string): HealthFixtures {
    return { ...FIXTURES, referenceDate, windowEnd: referenceDate };
  }

  it('lets two interleaved requests each read only the dataset they installed', async () => {
    const alexData = datasetFor('2026-01-10T12:00:00.000Z');
    const samData = datasetFor('2026-02-20T12:00:00.000Z');
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));

    const alex = runAsUser(identity('alex'), async () => {
      setActiveDataset(alexData, { mode: 'live' });
      await gate; // Sam's request installs its dataset while this one waits.
      return { data: activeDataset(), key: referenceDayKey(), mode: dataMode() };
    });
    const sam = runAsUser(identity('sam'), async () => {
      setActiveDataset(samData, { mode: 'live' });
      release();
      await Promise.resolve();
      return { data: activeDataset(), key: referenceDayKey() };
    });

    const [a, s] = await Promise.all([alex, sam]);
    expect(a.data).toBe(alexData);
    expect(a.key).toBe('2026-01-10');
    expect(a.mode).toBe('live');
    expect(s.data).toBe(samData);
    expect(s.key).toBe('2026-02-20');
  });

  it('serves the demo fixtures in a scope that installed nothing, and leaves the module state alone', () => {
    runAsUser(identity('sam'), () => {
      expect(activeDataset()).toBe(FIXTURES);
      setActiveDataset(datasetFor('2026-03-01T12:00:00.000Z'), { mode: 'live' });
    });
    // Outside any scope (the browser, tests) nothing a request installed is visible.
    expect(activeDataset()).toBe(FIXTURES);
  });
});
