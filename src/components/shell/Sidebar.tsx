'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Heart, FlaskConical, Activity, Moon, Weight,
  UtensilsCrossed, Dumbbell, Lightbulb, Bot, Settings, Pill,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  isAnalyst?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: <LayoutDashboard size={17} /> },
  { label: 'Trends', href: '/trends', icon: <TrendingUp size={17} /> },
  { label: 'Health', href: '/health', icon: <Heart size={17} /> },
  { label: 'Lab', href: '/lab', icon: <FlaskConical size={17} /> },
  { label: 'Medications', href: '/medications', icon: <Pill size={17} /> },
  { label: 'Activity', href: '/activity', icon: <Activity size={17} /> },
  { label: 'Sleep', href: '/sleep', icon: <Moon size={17} /> },
  { label: 'Body', href: '/body', icon: <Weight size={17} /> },
  { label: 'Nutrition', href: '/nutrition', icon: <UtensilsCrossed size={17} /> },
  { label: 'Workouts', href: '/workouts', icon: <Dumbbell size={17} /> },
  { label: 'Insights', href: '/insights', icon: <Lightbulb size={17} /> },
  { label: 'AI Analyst', href: '/analyst', icon: <Bot size={17} />, isAnalyst: true },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

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
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors min-h-[40px] ${
              isActive(item.href)
                ? 'bg-surface text-text-primary font-medium shadow-card ring-1 ring-border'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted/70'
            }`}
          >
            <span className={`shrink-0 ${isActive(item.href) || item.isAnalyst ? 'text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.isAnalyst && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-tint text-primary">AI</span>
            )}
          </Link>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-0.5 pt-2">
        <ThemeToggle />
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors min-h-[40px] ${
            pathname.startsWith('/settings')
              ? 'bg-surface text-text-primary font-medium shadow-card ring-1 ring-border'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted/70'
          }`}
        >
          <Settings size={17} />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
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
