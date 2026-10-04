'use client';

// ── Live-source gate ─────────────────────────────────────
//
// When live mode has no readable source, the pages are replaced by the
// connection error. Settings is never replaced: it is the one place a source
// can be connected (its Connections card), so hiding it would make the error
// impossible to resolve.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConnectionErrorState, type ConnectionErrorStateProps } from './ConnectionErrorState';

export function showsConnectionError(pathname: string | null): boolean {
  if (!pathname) return true;
  return !(pathname === '/settings' || pathname.startsWith('/settings/'));
}

export function LiveGate({
  failure,
  children,
}: {
  failure: ConnectionErrorStateProps | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (failure && showsConnectionError(pathname)) {
    return <ConnectionErrorState {...failure} />;
  }
  return <>{children}</>;
}
