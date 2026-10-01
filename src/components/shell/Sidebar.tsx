'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { NAV_SECTIONS, resolveTrail, type NavSection, type Trail } from './nav';

const ROW = 'flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors min-h-[40px]';
const IDLE = 'text-text-secondary hover:text-text-primary hover:bg-surface-muted/70';
const CURRENT = 'bg-surface text-text-primary font-medium shadow-card ring-1 ring-border';

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
      className="fixed left-0 top-0 bottom-0 w-sidebar bg-page border-r border-border flex flex-col z-30"
      aria-label="Main navigation"
    >
      {/* Wordmark */}
      <Link href="/" className="flex items-center gap-2.5 px-5 h-16 shrink-0">
        <VitalIcon />
        <span className="text-[17px] font-semibold tracking-[-0.03em] text-text-primary">Vital</span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
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
      <div className="px-3 pb-4 space-y-0.5 pt-2">
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
  // in bold, and the raised chip goes to the page the reader is on.
  const tone = active
    ? pages.length > 0
      ? 'text-text-primary font-medium hover:bg-surface-muted/70'
      : CURRENT
    : IDLE;

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Link
          href={section.href}
          aria-current={active && pages.length === 0 ? (trail.crumbs.length === 1 ? 'page' : 'location') : undefined}
          className={`group ${ROW} flex-1 min-w-0 ${tone}`}
        >
          <Icon
            size={17}
            className={`shrink-0 ${active || section.isAnalyst ? 'text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}
            aria-hidden="true"
          />
          <span className="flex-1 truncate">{section.label}</span>
          {section.isAnalyst && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-tint text-primary">AI</span>
          )}
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
                  className={`flex items-center px-3 py-1.5 rounded-lg text-[13.5px] transition-colors min-h-[34px] ${
                    current ? CURRENT : IDLE
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

// ── Vital mark: a rounded accent tile with a single pulse line ──
function VitalIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect width="26" height="26" rx="7.5" fill="var(--color-primary)" />
      <path
        d="M5 13.5h3.6l2.2-5.2 3.4 9.4 2.2-4.2H21"
        stroke="var(--color-primary-text)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
