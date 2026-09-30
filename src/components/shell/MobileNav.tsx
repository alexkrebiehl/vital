'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Dialog } from '@/components/ui/primitives';
import { NAV_SECTIONS, resolveTrail } from './nav';

// Both lists come from the navigation registry: the primary sections sit in the
// bottom bar, and every other one behind "More", with its own pages beneath it.
const PRIMARY = NAV_SECTIONS.filter(s => s.primary);
const MORE = NAV_SECTIONS.filter(s => !s.primary);

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const trail = resolveTrail(pathname);
  const isActive = (id: string) => trail.section?.id === id;

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-around h-16 z-30 md:hidden"
        aria-label="Mobile navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {PRIMARY.map(item => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.id) ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px] min-h-[44px] ${
                isActive(item.id) ? 'text-primary' : 'text-text-secondary'
              }`}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="text-[10px] font-medium">{item.mobileLabel ?? item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px] min-h-[44px] ${
            MORE.some(m => isActive(m.id)) ? 'text-primary' : 'text-text-secondary'
          }`}
        >
          <Menu size={20} aria-hidden="true" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="All destinations">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-secondary">Every page in Vital</p>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="p-1.5 rounded-md hover:bg-surface-muted text-text-secondary"
            aria-label="Close destinations"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="list-none p-0 m-0 grid grid-cols-2 gap-2">
          {MORE.map(item => {
            const Icon = item.icon;
            // A section's landing page is the tile itself, so only its other
            // pages are listed beneath it.
            const pages = (item.children ?? []).filter(p => p.href !== item.href);
            return (
              <li key={item.href} className={pages.length > 0 ? 'col-span-2' : undefined}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-3 rounded-control text-sm min-h-[44px] ${
                    isActive(item.id) ? 'bg-accent-tint text-primary font-medium' : 'bg-surface-muted text-text-primary'
                  }`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
                {pages.length > 0 && (
                  <ul className="list-none p-0 m-0 mt-1.5 flex flex-wrap gap-1.5" aria-label={`${item.label} pages`}>
                    {pages.map(page => {
                      const current = isActive(item.id) && trail.page?.id === page.id;
                      return (
                        <li key={page.id}>
                          <Link
                            href={page.href}
                            onClick={() => setMoreOpen(false)}
                            aria-current={current ? 'page' : undefined}
                            className={`inline-flex items-center px-3 rounded-full text-xs min-h-[36px] border ${
                              current
                                ? 'border-primary/40 bg-accent-tint text-primary font-medium'
                                : 'border-border text-text-secondary'
                            }`}
                          >
                            {page.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
