'use client';

// ── The frame around every card ─────────────────────────────────────────────
//
// docs/design/dashboard.md §8.4. Title and date label, the category colour
// rule, and two slots filled by later gates: a drag `handle` and the options
// menu's `actions`. Controls are always visible: nothing here depends on hover.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { CATEGORY_VAR } from '@/components/art/categories';
import { artCategoryOf } from '@/components/domain/DomainShared';
import { Button, Card } from '@/components/ui/primitives';

export interface CardAction {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface CardShellProps {
  cardId?: string;
  title: string;
  dateLabel?: string;
  /** Picks the category colour. */
  metricId?: string;
  handle?: ReactNode;
  actions: CardAction[];
  /** An unreadable card: this sentence stands in for the body. */
  problem?: string;
  children?: ReactNode;
}

function OptionsMenu({ cardId, title, actions }: { cardId?: string; title: string; actions: CardAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Options for ${title}`}
        data-card-options={cardId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-control border border-border bg-surface-elevated py-1 shadow-pop"
        >
          {actions.map(a => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                a.danger ? 'text-category-attention' : 'text-text-primary'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardShell({ cardId, title, dateLabel, metricId, handle, actions, problem, children }: CardShellProps) {
  const titleId = useId();
  const color = CATEGORY_VAR[metricId ? artCategoryOf(metricId) : 'neutral'];
  return (
    <Card
      as="article"
      aria-labelledby={titleId}
      data-card-id={cardId}
      className="relative flex h-full flex-col overflow-hidden p-5"
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} aria-hidden="true" />
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
            <h3 id={titleId} className="text-[13px] font-medium text-text-primary">
              {title}
            </h3>
          </div>
          {dateLabel && <p className="mt-0.5 text-[11px] text-text-secondary">{dateLabel}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {handle}
          {actions.length > 0 && <OptionsMenu cardId={cardId} title={title} actions={actions} />}
        </div>
      </header>
      <div className="flex-1">
        {problem ? <p className="text-sm text-text-secondary">{problem}</p> : children}
      </div>
    </Card>
  );
}
