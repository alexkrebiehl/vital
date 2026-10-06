'use client';

// ── Setup mode: the live-source gate ─────────────────────
//
// In live mode, until at least one source is connected and a read succeeds, the
// app is in setup mode: no navigation, and Settings → Connections is the only
// page. Any other path is redirected there (and renders nothing while it is, so
// no page content flashes). Settings itself is never replaced: it is where a
// source is connected.
//
// When the data loads the layout stops passing a failure and everything returns
// to normal on its own. Demo mode never has a failure, so it is never gated.

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SetupFailureContext, type SetupFailure } from './setup-mode';

export const SETUP_TARGET = '/settings?tab=connections';

/** Exactly /settings (a trailing slash allowed): `/settingsx` is another page. */
export function isSettingsPath(pathname: string | null): boolean {
  return pathname === '/settings' || pathname === '/settings/';
}

/** True for every page that setup mode keeps from showing. */
export function showsConnectionError(pathname: string | null): boolean {
  return !isSettingsPath(pathname);
}

/** Where setup mode sends this location, or null when it may stay. */
export function setupRedirectTarget(pathname: string | null, tab: string | null): string | null {
  if (showsConnectionError(pathname)) return SETUP_TARGET;
  return tab ? null : SETUP_TARGET;
}

export function LiveGate({ failure, children }: { failure: SetupFailure | null; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tab = useSearchParams()?.get('tab') ?? null;
  const target = failure ? setupRedirectTarget(pathname, tab) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) return null;
  return <SetupFailureContext.Provider value={failure}>{children}</SetupFailureContext.Provider>;
}
