'use client';

import { Command, Search, UserRound } from 'lucide-react';
import { useCommandPalette } from '@/components/ui/CommandPalette';
import { useProfile } from '@/components/profile/ProfileProvider';
import { initialsOf } from '@/lib/profile/types';

/**
 * Application top bar.
 *
 * The surface is fully opaque with a bottom hairline so scrolled content can
 * never bleed through it, and the search affordance collapses to an icon button
 * on narrow viewports instead of squeezing a placeholder onto three lines.
 *
 * `minimal` (setup mode) leaves out the search palette: the bar is then only the avatar,
 * with no link anywhere.
 *
 * The data-freshness control deliberately does NOT live here: provenance is a
 * Settings concern, and the Data pipeline panel is opened from there.
 *
 * The avatar follows the configured profile name — initials and accessible label
 * both. With no name configured it shows a neutral icon and a neutral label
 * rather than a literal name.
 */
export function TopBar({ minimal = false }: { minimal?: boolean }) {
  const { open } = useCommandPalette();
  const { profile } = useProfile();
  const name = profile.name?.trim() || null;
  const initials = initialsOf(name);

  return (
    <header className="h-16 border-b border-border flex items-center gap-2 px-4 md:px-8 bg-page/85 backdrop-blur-md sticky top-0 z-20">
      {/* Search — icon-only below sm, full field above */}
      {!minimal && (
        <>
        <button
          onClick={open}
          className="hidden sm:flex items-center gap-2 w-full max-w-md min-w-0 px-3 py-1.5 bg-surface border border-border rounded-control text-sm text-text-secondary shadow-card hover:border-border-strong transition-colors min-h-[38px]"
          aria-label="Search your health data"
        >
          <Search size={15} className="shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left truncate">Search your health data…</span>
          <span className="flex items-center gap-0.5 text-[10px] text-text-secondary bg-surface-muted px-1.5 py-0.5 rounded-md shrink-0 font-mono">
            <Command size={10} aria-hidden="true" />K
          </span>
        </button>
        <button
          onClick={open}
          className="sm:hidden inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-control text-text-secondary hover:text-text-primary hover:bg-surface-muted transition-colors"
          aria-label="Search your health data"
        >
          <Search size={18} aria-hidden="true" />
        </button>
        </>
      )}

      <div className="flex-1 min-w-0" />

      {/* Avatar — initials from the profile name, or a neutral icon. */}
      <div
        className="w-8 h-8 rounded-full bg-accent-tint text-primary ring-1 ring-border flex items-center justify-center text-xs font-semibold shrink-0"
        aria-label={name ? `Signed in as ${name}` : 'Account profile'}
        title={name ?? 'Account profile'}
      >
        {initials ?? <UserRound size={16} aria-hidden="true" />}
      </div>
    </header>
  );
}
