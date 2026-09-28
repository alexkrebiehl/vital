'use client';

// ── /themes ─────────────────────────────────────────────
//
// Pick how Vital looks: the mode (light, dark or match the system) and one
// theme for each side. Under "Match system" the operating system chooses the
// side and the side's pick is shown, the way GitHub's theme settings work.
//
// The choices are ordinary display preferences, so they are saved to the
// server-owned record like the rest of Settings and follow the reader between
// browsers and devices. A choice is applied to the page at once, then saved.

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import {
  applyTheme, getPreferencesState, loadPreferences, resolveTheme, savePreferencesResult, subscribePreferences,
  syncPreferences, themesFor, type ColorScheme, type ThemeMode, type VitalPreferences,
} from '@/lib/prefs';
import { ChoiceButton, Skeleton } from '@/components/ui/primitives';
import { DomainHeader, SectionTitle } from '@/components/domain/DomainShared';
import { ThemeCard } from './ThemeCard';

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'Match system' },
];

const SIDES: { scheme: ColorScheme; title: string; field: 'lightTheme' | 'darkTheme' }[] = [
  { scheme: 'light', title: 'Light', field: 'lightTheme' },
  { scheme: 'dark', title: 'Dark', field: 'darkTheme' },
];

/** Whether the operating system asks for dark, kept current while the page is open. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const read = () => setDark(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, []);
  return dark;
}

export function ThemesPage() {
  const [prefs, setPrefs] = useState<VitalPreferences | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const systemDark = useSystemDark();

  // The cached value for the first paint, then the server's record.
  useEffect(() => {
    setPrefs(loadPreferences());
    const unsubscribe = subscribePreferences(() => setPrefs(getPreferencesState().preferences));
    void syncPreferences();
    return unsubscribe;
  }, []);

  const flash = useCallback((tone: 'ok' | 'warn' | 'error', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const choose = useCallback(
    async (change: Partial<Pick<VitalPreferences, 'theme' | 'lightTheme' | 'darkTheme'>>) => {
      const next = { ...loadPreferences(), ...change };
      setPrefs(next);
      applyTheme(next);
      const outcome = await savePreferencesResult(next);
      if (outcome.ok) flash('ok', 'Saved to your account — this applies on every browser and device.');
      else if (outcome.reason === 'conflict') flash('warn', outcome.message || 'Your theme changed somewhere else. Nothing was saved.');
      else flash('error', outcome.message || 'Your theme could not be saved.');
    },
    [flash]
  );

  if (!prefs) {
    return (
      <div className="space-y-6">
        <h1 className="text-[26px] md:text-[32px] font-semibold tracking-tight text-text-primary leading-tight">Themes</h1>
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading your saved theme</span>
          <Skeleton height={56} />
          <Skeleton height={240} />
        </div>
      </div>
    );
  }

  const shown = resolveTheme(prefs, systemDark);

  return (
    <div className="space-y-8">
      <DomainHeader title="Themes" subtitle="Choose how Vital looks: light, dark or following your system, and a theme for each.">
        {notice && (
          <span
            role="status"
            className={
              'inline-flex items-center gap-1 text-xs ' +
              (notice.tone === 'ok'
                ? 'text-text-secondary'
                : notice.tone === 'warn'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-red-700 dark:text-red-400')
            }
          >
            <Save size={12} aria-hidden="true" /> {notice.text}
          </span>
        )}
      </DomainHeader>

      <section aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="text-sm font-semibold text-text-primary mb-2">
          Appearance
        </h2>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="appearance-title">
          {MODES.map(m => (
            <ChoiceButton key={m.mode} active={prefs.theme === m.mode} onClick={() => void choose({ theme: m.mode })} label={m.label} />
          ))}
        </div>
        <p className="text-xs text-text-secondary mt-2">
          {prefs.theme === 'system'
            ? `Following your system, which is ${systemDark ? 'dark' : 'light'} right now. Your light and dark picks below take turns.`
            : `Always ${prefs.theme}. Picking a ${prefs.theme === 'light' ? 'dark' : 'light'} theme switches to it.`}
        </p>
      </section>

      {SIDES.map(side => (
        <section key={side.scheme} aria-label={`${side.title} themes`}>
          <SectionTitle hint={side.scheme === shown.scheme ? 'Showing now' : undefined}>{side.title}</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {themesFor(side.scheme).map(theme => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={prefs[side.field] === theme.id}
                inUse={shown.scheme === side.scheme && shown.id === theme.id}
                onSelect={() =>
                  void choose({
                    [side.field]: theme.id,
                    // A fixed mode on the other side moves to this one; Match system stays.
                    ...(prefs.theme !== 'system' && prefs.theme !== side.scheme ? { theme: side.scheme } : {}),
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
