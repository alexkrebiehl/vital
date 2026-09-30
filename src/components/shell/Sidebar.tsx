'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { NAV_SECTIONS, resolveTrail, type NavSection, type Trail } from './nav';

const ROW = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors min-h-[40px]';
const IDLE = 'text-text-secondary hover:text-text-primary hover:bg-surface-muted';

/**
 * The desktop sidebar, drawn from the navigation registry.
 *
 * A section with pages of its own (Workouts) has a disclosure button beside its
 * link: the active section opens by itself, so the reader always sees where
 * they are inside it, and any other can be opened by hand.
 */
export function Sidebar() {
  const pathname = usePathname();
  const trail = resolveTrail(pathname);
  // Only the sections the reader has toggled by hand; the rest follow the route.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const activeId = trail.section?.id;

  // The sidebar outlives navigation, so a section collapsed by hand would stay
  // shut even after the reader moves to one of its pages. Arriving on a page
  // forgets that choice for the section holding it, which opens again. Adjusted
  // during render rather than in an effect, so it never paints collapsed first.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (activeId && activeId in toggled) {
      const { [activeId]: _, ...rest } = toggled;
      setToggled(rest);
    }
  }

  const isOpen = (id: string) => toggled[id] ?? activeId === id;
  const toggle = (id: string) => setToggled(prev => ({ ...prev, [id]: !isOpen(id) }));

  const main = NAV_SECTIONS.filter(s => s.placement === 'main');
  const footer = NAV_SECTIONS.filter(s => s.placement === 'footer');

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-sidebar bg-surface border-r border-border flex flex-col z-30"
      aria-label="Main navigation"
    >
      {/* Wordmark */}
      <Link href="/" className="flex items-center gap-2.5 px-5 h-14 shrink-0 border-b border-border">
        <VitalIcon />
        <span className="text-lg font-semibold tracking-tight text-text-primary">Vital</span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {main.map(section => (
          <SectionItem
            key={section.id}
            section={section}
            trail={trail}
            open={isOpen(section.id)}
            onToggle={() => toggle(section.id)}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2.5 pb-3 space-y-0.5 border-t border-border pt-2">
        {footer.map(section => (
          <SectionItem key={section.id} section={section} trail={trail} open={false} onToggle={() => {}} />
        ))}
      </div>
    </aside>
  );
}

function SectionItem({ section, trail, open, onToggle }: {
  section: NavSection;
  trail: Trail;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = section.icon;
  const active = trail.section?.id === section.id;
  const pages = section.children ?? [];
  const listId = `nav-${section.id}-pages`;

  // A section with pages is the frame, not the place: when active it is named
  // in the accent colour, and the tint goes to the page the reader is on.
  const tone = active
    ? pages.length > 0
      ? 'text-primary font-medium hover:bg-surface-muted'
      : 'bg-accent-tint text-primary font-medium'
    : IDLE;

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Link
          href={section.href}
          aria-current={active && pages.length === 0 ? (trail.crumbs.length === 1 ? 'page' : 'location') : undefined}
          className={`${ROW} flex-1 min-w-0 ${tone} ${section.isAnalyst ? 'opacity-90 hover:opacity-100' : ''}`}
        >
          <Icon size={17} className="shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate">{section.label}</span>
        </Link>
        {pages.length > 0 && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${open ? 'Hide' : 'Show'} ${section.label} pages`}
            className={`shrink-0 w-8 h-10 inline-flex items-center justify-center rounded-lg ${IDLE}`}
          >
            <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {pages.length > 0 && open && (
        <ul id={listId} className="list-none m-0 mt-0.5 mb-1 ml-[21px] pl-2.5 border-l border-border space-y-0.5">
          {pages.map(page => {
            const current = active && trail.page?.id === page.id;
            return (
              <li key={page.id}>
                <Link
                  href={page.href}
                  aria-current={current ? (trail.crumbs.at(-1)?.href === page.href || trail.crumbs.length === 1 ? 'page' : 'location') : undefined}
                  className={`flex items-center px-3 py-1.5 rounded-lg text-sm transition-colors min-h-[34px] ${
                    current ? 'bg-accent-tint text-primary font-medium' : IDLE
                  }`}
                >
                  {page.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Original Vital Icon (abstract SVG, no cliche heart/pulse) ──
function VitalIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-primary"
    >
      {/* Two intersecting organic curves suggesting health/life */}
      <path
        d="M4 14C6 10 9 7 12 12C15 17 18 14 20 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 10C6 14 9 17 12 12C15 7 18 10 20 14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}
