// ── The Settings tab list and the address → tab rule ─────────────────────────

import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, resolveTab } from './tabs';

describe('Settings tabs', () => {
  it('lists Sources right after Data & coverage, before Connections', () => {
    expect(SETTINGS_TABS.map(t => t.id)).toEqual(['account', 'preferences', 'data', 'sources', 'connections', 'privacy']);
    expect(SETTINGS_TABS.find(t => t.id === 'sources')?.label).toBe('Sources');
    expect(SETTINGS_TABS.find(t => t.id === 'connections')?.label).toBe('Connections');
  });

  it('opens a known tab from the address and falls back to Account otherwise', () => {
    expect(resolveTab('sources')).toBe('sources');
    expect(resolveTab('connections')).toBe('connections'); // a legacy link still opens Connections
    expect(resolveTab('nope')).toBe('account');
    expect(resolveTab(null)).toBe('account');
  });
});
