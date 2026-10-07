// ── Settings tabs ────────────────────────────────────────────────────────────
//
// Sources holds every connection (health-data sources, workout sources, map
// sources); Connections holds the data pipeline with its data quality. The
// first-run gate opens Sources.

export const SETTINGS_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'data', label: 'Data & coverage' },
  { id: 'sources', label: 'Sources' },
  { id: 'connections', label: 'Connections' },
  { id: 'privacy', label: 'AI privacy' },
];

export function isSettingsTab(id: string | null): id is string {
  return id !== null && SETTINGS_TABS.some(tab => tab.id === id);
}

/** The tab an address asks for: a known tab, or Account. */
export function resolveTab(requested: string | null): string {
  return isSettingsTab(requested) ? requested : 'account';
}
