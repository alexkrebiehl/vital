'use client';

// ── Profile switcher (the top-bar avatar) ───────────────
//
// With one profile the avatar is just an avatar. With several declared profiles
// (VITAL_PROFILES) it opens a menu of them; picking one stores the choice in a
// cookie through /api/session/profile and reloads, so every server read, the
// dataset and every client cache start over as that person.
//
// This is a household switcher, not a sign-in: it does not protect one
// profile from another.

import { useEffect, useRef, useState } from 'react';
import { Check, UserRound } from 'lucide-react';
import { useProfile } from '@/components/profile/ProfileProvider';
import { initialsOf } from '@/lib/profile/types';
import type { ProfileOption, ProfileSwitcherState } from '@/lib/identity/types';

const AVATAR_CLASS =
  'w-8 h-8 rounded-full bg-accent-tint text-primary ring-1 ring-border flex items-center justify-center text-xs font-semibold shrink-0';

/** The name a profile is listed under: its stored name, else its slug. */
function labelOf(option: ProfileOption): string {
  return option.name?.trim() || option.slug;
}

export function ProfileSwitcher({ switcher }: { switcher: ProfileSwitcherState }) {
  const { profile } = useProfile();
  const name = profile.name?.trim() || null;
  const initials = initialsOf(name);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const avatar = initials ?? <UserRound size={16} aria-hidden="true" />;

  if (!switcher.canSwitch) {
    return (
      <div
        className={AVATAR_CLASS}
        aria-label={name ? `Signed in as ${name}` : 'Account profile'}
        title={name ?? 'Account profile'}
      >
        {avatar}
      </div>
    );
  }

  async function choose(slug: string) {
    if (slug === switcher.current) {
      setOpen(false);
      return;
    }
    setSwitching(slug);
    setError(null);
    try {
      const res = await fetch('/api/session/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      // A full reload: the dataset, the settings cache and every page state
      // belong to the profile they were loaded for.
      window.location.reload();
    } catch (e) {
      setSwitching(null);
      setError(e instanceof Error ? e.message : 'The profile could not be switched.');
    }
  }

  const currentLabel = name ?? switcher.options.find(o => o.slug === switcher.current)?.slug ?? 'Account profile';

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${AVATAR_CLASS} hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-shadow`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile: ${currentLabel}. Switch profile`}
        title={`${currentLabel} — switch profile`}
      >
        {avatar}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Switch profile"
          className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-control shadow-card py-1 z-30"
        >
          <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Profiles</p>
          {switcher.options.map(option => {
            const current = option.slug === switcher.current;
            const label = option.slug === switcher.current ? currentLabel : labelOf(option);
            return (
              <button
                key={option.slug}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                disabled={switching !== null}
                onClick={() => void choose(option.slug)}
                className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] text-left text-sm text-text-primary hover:bg-surface-muted disabled:opacity-60 transition-colors"
              >
                <span className="w-7 h-7 rounded-full bg-accent-tint text-primary flex items-center justify-center text-[11px] font-semibold shrink-0">
                  {initialsOf(label)}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {label}
                  {switching === option.slug && <span className="text-text-secondary"> — switching…</span>}
                </span>
                {current && <Check size={16} className="text-primary shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-text-secondary">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
