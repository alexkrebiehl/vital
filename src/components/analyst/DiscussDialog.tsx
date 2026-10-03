'use client';

// ── "Discuss with analyst" dialog ───────────────────────
//
// The analyst in a dialog, opened from the page the reader is on. It is the AI
// Analyst page's chat — same endpoint, same tools, same answers, saved to the
// same conversation store — with the page named as context: the server resolves
// it into the page's current state for the model (lib/analyst/page-context.ts).
//
// The chat mounts when the dialog opens and unmounts when it closes, so every
// opening starts a new conversation; "Open in AI Analyst" continues this one.
//
// One dialog lives in the app shell (DiscussProvider) rather than beside each
// button: a plan change can remove the very row or card that opened it (an
// exercise added to the plan leaves the "not in the plan" list), and the
// conversation must not vanish with it. It closes when the route changes.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Bot, ExternalLink, MessageSquare } from 'lucide-react';
import { Badge, Button, Dialog } from '@/components/ui/primitives';
import type { PageContextRef } from '@/lib/analyst/page-context-types';
import type { PlanChange } from '@/lib/routine/types';
import { ChatComposer } from './ChatComposer';
import { ChatThread, PromptChip } from './ChatThread';
import { useAnalystChat } from './useAnalystChat';
import { providerBadge, useAnalystConfig } from './useAnalystConfig';

interface DiscussProps {
  /** The page the dialog was opened from. */
  context: PageContextRef;
  /** What is being discussed, in words ("the Pull-up path"). */
  subject: string;
  /** Questions built from what the page shows. */
  suggestions: string[];
  /** An answer changed (or the reader undid a change to) the training plan: reload the page. */
  onPlanChange?: (change: PlanChange | null) => void;
}

const DiscussContext = createContext<((props: DiscussProps) => void) | null>(null);

/** Hosts the one "Discuss with analyst" dialog for every page under it. */
export function DiscussProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DiscussProps | null>(null);
  const pathname = usePathname();
  const close = useCallback(() => setCurrent(null), []);

  useEffect(() => {
    setCurrent(null);
  }, [pathname]);

  return (
    <DiscussContext.Provider value={setCurrent}>
      {children}
      <Dialog open={current !== null} onClose={close} title="Discuss with analyst" size="lg">
        {current && <DiscussChat {...current} />}
      </Dialog>
    </DiscussContext.Provider>
  );
}

function DiscussChat({ context, subject, suggestions, onPlanChange }: DiscussProps) {
  const { state: configState } = useAnalystConfig();
  const providerReady = configState?.configured === true;
  const misconfigured = configState?.misconfigured === true;

  const handlePlanChange = useCallback((change: PlanChange) => onPlanChange?.(change), [onPlanChange]);
  const { exchanges, pending, activeId, ask, stop } = useAnalystChat({ context, onPlanChange: handlePlanChange });

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <p className="text-sm text-text-secondary min-w-0">
          About <span className="text-text-primary font-medium">{subject}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={providerReady ? 'accent' : 'default'} className="text-[10px]">
            {providerBadge(configState)}
          </Badge>
          {activeId !== null && (
            <Link
              href={`/analyst?c=${activeId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
            >
              Open in AI Analyst
              <ExternalLink size={11} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {misconfigured && (
        <p role="note" className="text-xs text-category-attention shrink-0">
          {configState?.providerDisplayName} is misconfigured: {configState?.misconfiguredReason}
        </p>
      )}

      <ChatThread
        exchanges={exchanges}
        pending={pending}
        onAsk={q => void ask(q)}
        onPlanUndone={() => onPlanChange?.(null)}
        className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1"
        empty={
          <div className="py-6 text-center">
            <Bot size={28} className="mx-auto text-text-secondary mb-3" aria-hidden="true" />
            <p className="text-sm text-text-primary font-medium mb-1">Ask about {subject}</p>
            <p className="text-xs text-text-secondary mb-4 max-w-md mx-auto">
              {providerReady
                ? 'The analyst sees what this page shows, and can change your training plan when you ask. Pick a question or type your own.'
                : 'The demo analyst matches questions by pattern. Pick a question below, or ask about your routine or plan.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map(q => (
                <PromptChip key={q} prompt={q} onAsk={q => void ask(q)} />
              ))}
            </div>
          </div>
        }
      />

      <div className="shrink-0">
        <ChatComposer
          onSend={q => void ask(q)}
          onStop={stop}
          pending={pending}
          providerReady={providerReady}
          placeholder={`Ask about ${subject}…`}
          autoFocus
        />
        <p className="text-[10px] text-text-secondary mt-1 leading-relaxed">
          Informational only: not a diagnosis or a substitute for a qualified professional.
        </p>
      </div>
    </div>
  );
}

/** A trigger that opens the dialog: a button by default, or an inline text link. */
export function DiscussButton({
  label = 'Discuss with analyst',
  appearance = 'button',
  variant,
  ...props
}: DiscussProps & { label?: string; appearance?: 'button' | 'link'; variant?: 'primary' | 'secondary' }) {
  const openDiscuss = useContext(DiscussContext);
  if (!openDiscuss) throw new Error('DiscussButton must be rendered inside a DiscussProvider.');
  const open = () => openDiscuss(props);
  return appearance === 'link' ? (
    <button type="button" onClick={open} className="text-xs font-medium text-primary hover:underline underline-offset-2 shrink-0">
      {label}
    </button>
  ) : (
    <Button size="sm" variant={variant} onClick={open}>
      <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
