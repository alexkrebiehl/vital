'use client';

// ── Breadcrumbs ─────────────────────────────────────────
//
// The trail from the section down to the current page, rendered by AppShell
// above every page, so no page hand-writes its own back link. The trail comes
// from the navigation registry (nav.ts); a detail page whose name is only known
// once its data loads (a path, a workout, an analyte) supplies it with
// useBreadcrumbLabel, and the registry's generic label stands in until then.
//
// On phones the trail collapses to a single "‹ Parent" link.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { resolveTrail } from './nav';

interface LabelOverride {
  pathname: string;
  label: string;
}

const BreadcrumbContext = createContext<{
  override: LabelOverride | null;
  setOverride: (update: (prev: LabelOverride | null) => LabelOverride | null) => void;
}>({ override: null, setOverride: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<LabelOverride | null>(null);
  return <BreadcrumbContext.Provider value={{ override, setOverride }}>{children}</BreadcrumbContext.Provider>;
}

/** Names the current page in the breadcrumb trail; `undefined` keeps the registry's label. */
export function useBreadcrumbLabel(label: string | undefined) {
  const pathname = usePathname();
  const { setOverride } = useContext(BreadcrumbContext);
  useEffect(() => {
    if (!label) return;
    setOverride(() => ({ pathname, label }));
    return () => setOverride(prev => (prev?.pathname === pathname && prev.label === label ? null : prev));
  }, [pathname, label, setOverride]);
}

const LINK = 'text-text-secondary hover:text-text-primary transition-colors';

export function Breadcrumbs() {
  const pathname = usePathname();
  const { override } = useContext(BreadcrumbContext);
  const crumbs = resolveTrail(pathname).crumbs;
  if (crumbs.length < 2) return null;

  // Only the page that set the label may rename its crumb; a stale one from the
  // page being left must not flash onto the next.
  if (override?.pathname === pathname) {
    crumbs[crumbs.length - 1] = { ...crumbs[crumbs.length - 1], label: override.label };
  }
  const parent = crumbs[crumbs.length - 2];

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm">
      <Link href={parent.href} className={`md:hidden inline-flex items-center gap-1 min-h-[44px] -my-2.5 ${LINK}`}>
        <ChevronLeft size={14} aria-hidden="true" />
        <span>{parent.label}</span>
      </Link>
      <ol className="hidden md:flex flex-wrap items-center gap-1 list-none p-0 m-0">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.href} className="inline-flex items-center gap-1 min-w-0">
              {last ? (
                <span aria-current="page" className="text-text-primary font-medium truncate">
                  {crumb.label}
                </span>
              ) : (
                <>
                  <Link href={crumb.href} className={LINK}>
                    {crumb.label}
                  </Link>
                  <ChevronRight size={14} className="text-text-secondary opacity-60 shrink-0" aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
