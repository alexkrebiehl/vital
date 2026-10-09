// ── The disclosure is generated from the registry (design §9.1) ──────────────

import { describe, expect, it } from 'vitest';
import { ALWAYS_SENT, SENDING_CATEGORY_SENTENCES } from './capabilities/categories';
import { CAPABILITY_MANIFEST } from './capabilities/manifest';
import { CAPABILITIES } from './capabilities/registry';
import { publicConfigState, readAnalystConfig, REMOTE_SENDING_CATEGORIES, remoteSendingCategories } from './config';

describe('REMOTE_SENDING_CATEGORIES', () => {
  const categoriesInUse = [...new Set(CAPABILITIES.map(c => c.category))];

  it('has a sentence for every category a capability uses', () => {
    for (const c of categoriesInUse) expect(REMOTE_SENDING_CATEGORIES, c).toContain(SENDING_CATEGORY_SENTENCES[c]);
  });

  it('lists nothing for a category no capability uses', () => {
    const unused = (Object.keys(SENDING_CATEGORY_SENTENCES) as (keyof typeof SENDING_CATEGORY_SENTENCES)[]).filter(c => !categoriesInUse.includes(c));
    for (const c of unused) expect(REMOTE_SENDING_CATEGORIES, c).not.toContain(SENDING_CATEGORY_SENTENCES[c]);
  });

  it('says what the always-sent context is, once, last', () => {
    expect(REMOTE_SENDING_CATEGORIES.at(-1)).toBe(ALWAYS_SENT);
    expect(REMOTE_SENDING_CATEGORIES.filter(s => s === ALWAYS_SENT)).toHaveLength(1);
  });

  it('has no duplicate line', () => {
    expect(new Set(REMOTE_SENDING_CATEGORIES).size).toBe(REMOTE_SENDING_CATEGORIES.length);
  });

  it('now says what it used to leave out: workouts, sleep nights, blood pressure, medication records, the body goal and profile context', () => {
    const text = REMOTE_SENDING_CATEGORIES.join('\n');
    for (const word of [/workouts/i, /sleep nights/i, /blood pressure/i, /medication records/i, /body goal/i, /profile context/i]) expect(text).toMatch(word);
  });

  it('keeps naming lab results', () => {
    expect(REMOTE_SENDING_CATEGORIES.some(c => /lab result/i.test(c))).toBe(true);
  });

  it('follows the registry: a capability with a new category adds its sentence, and one removed takes it away', () => {
    const entries = CAPABILITY_MANIFEST.filter(e => e.category !== 'locations-coarse');
    expect(remoteSendingCategories(entries)).not.toContain(SENDING_CATEGORY_SENTENCES['locations-coarse']);
    const withDaily = [...entries, { ...CAPABILITY_MANIFEST[0]!, category: 'daily-values' as const }];
    expect(remoteSendingCategories(withDaily)).toContain(SENDING_CATEGORY_SENTENCES['daily-values']);
  });

  it('is what Settings shows for a configured provider, and nothing for the demo', () => {
    const remote = { ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'https://analyst.example.invalid/v1', ANALYST_API_KEY: 'k', ANALYST_MODEL: 'm' } as unknown as NodeJS.ProcessEnv;
    expect(publicConfigState(readAnalystConfig(remote)).sendingCategories).toEqual(REMOTE_SENDING_CATEGORIES);
    expect(publicConfigState(readAnalystConfig({} as NodeJS.ProcessEnv)).sendingCategories).toEqual([]);
  });
});
