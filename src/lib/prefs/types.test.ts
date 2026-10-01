import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  PREFS_SCHEMA_VERSION,
  parseLegacyPreferences,
  validatePreferencesInput,
  validatePreferencesRecord,
} from './types';
import { DEFAULT_THEME_ID, isThemeId, themeAttr, themesFor } from './themes';
import { resolveTheme } from './index';

const input = (over: Record<string, unknown> = {}) => ({
  theme: 'system',
  lightTheme: 'default',
  darkTheme: 'default',
  units: 'metric',
  notifications: { dailyBriefing: true, weeklyReport: false, staleData: true },
  revision: 3,
  ...over,
});

const record = (over: Record<string, unknown> = {}) => {
  const { revision: _revision, ...rest } = input();
  return { ...rest, schemaVersion: PREFS_SCHEMA_VERSION, revision: 3, updatedAt: '2026-09-28T12:00:00.000Z', ...over };
};

describe('theme catalogue', () => {
  it('has a default theme on each side', () => {
    expect(themesFor('light').map(t => t.id)).toContain(DEFAULT_THEME_ID);
    expect(themesFor('dark').map(t => t.id)).toContain(DEFAULT_THEME_ID);
  });

  it('scopes ids to a side and names the data-theme value', () => {
    expect(isThemeId('light', 'default')).toBe(true);
    expect(isThemeId('dark', 'nope')).toBe(false);
    expect(isThemeId('dark', 42)).toBe(false);
    expect(themeAttr('dark', 'default')).toBe('dark-default');
  });
});

describe('validatePreferencesInput: theme picks', () => {
  it('accepts known picks', () => {
    const v = validatePreferencesInput(input());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.preferences).toMatchObject({ lightTheme: 'default', darkTheme: 'default' });
  });

  it('rejects an unknown pick', () => {
    const v = validatePreferencesInput(input({ darkTheme: 'no-such-theme' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(' ')).toContain('"darkTheme"');
  });

  it('rejects a missing pick, since a PUT replaces the whole record', () => {
    const { lightTheme: _lightTheme, ...body } = input();
    const v = validatePreferencesInput(body);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(' ')).toContain('"lightTheme"');
  });
});

describe('validatePreferencesRecord: theme picks', () => {
  it('reads a record from before picks existed as the default theme', () => {
    const { lightTheme: _l, darkTheme: _d, ...old } = record();
    const v = validatePreferencesRecord(old);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toMatchObject({ lightTheme: DEFAULT_THEME_ID, darkTheme: DEFAULT_THEME_ID });
  });

  it('reads an unknown pick as the default instead of rejecting the record', () => {
    const v = validatePreferencesRecord(record({ lightTheme: 'removed-theme' }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.lightTheme).toBe(DEFAULT_THEME_ID);
  });

  it('still rejects other unknown fields', () => {
    expect(validatePreferencesRecord(record({ accent: 'pink' })).ok).toBe(false);
  });
});

describe('parseLegacyPreferences: theme picks', () => {
  it('defaults both picks when absent', () => {
    expect(parseLegacyPreferences(JSON.stringify({ theme: 'dark' }))).toMatchObject({
      theme: 'dark',
      lightTheme: DEFAULT_THEME_ID,
      darkTheme: DEFAULT_THEME_ID,
    });
  });

  it('keeps a known pick and defaults an unknown one', () => {
    const parsed = parseLegacyPreferences(JSON.stringify({ lightTheme: 'default', darkTheme: 7 }));
    expect(parsed).toMatchObject({ lightTheme: 'default', darkTheme: DEFAULT_THEME_ID });
  });

  it('the defaults carry both picks', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ lightTheme: DEFAULT_THEME_ID, darkTheme: DEFAULT_THEME_ID });
  });
});

describe('resolveTheme', () => {
  const picks = { lightTheme: 'l-pick', darkTheme: 'd-pick' };

  it('a fixed mode shows that side, whatever the system says', () => {
    expect(resolveTheme({ theme: 'light', ...picks }, true)).toEqual({ scheme: 'light', id: 'l-pick', attr: 'light-l-pick' });
    expect(resolveTheme({ theme: 'dark', ...picks }, false)).toEqual({ scheme: 'dark', id: 'd-pick', attr: 'dark-d-pick' });
  });

  it('Match system follows the system', () => {
    expect(resolveTheme({ theme: 'system', ...picks }, true).attr).toBe('dark-d-pick');
    expect(resolveTheme({ theme: 'system', ...picks }, false).attr).toBe('light-l-pick');
  });

  it('reads the system through matchMedia by default, and is light without a window', () => {
    expect(resolveTheme({ theme: 'system', ...picks }).scheme).toBe('light');
    const g = globalThis as { window?: unknown };
    g.window = { matchMedia: () => ({ matches: true }) };
    try {
      expect(resolveTheme({ theme: 'system', ...picks }).scheme).toBe('dark');
    } finally {
      delete g.window;
    }
  });
});
