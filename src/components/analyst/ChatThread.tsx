'use client';

// ── Analyst thread (SPEC §8) ────────────────────────────
//
// The questions and answers of one conversation, newest kept in view. Shared by
// the AI Analyst page and the "Discuss with analyst" dialog.

import { useEffect, useRef, type ReactNode } from 'react';
import { Sparkles, User } from 'lucide-react';
import { Card, ErrorState } from '@/components/ui/primitives';
import { AnswerPending, AnswerView } from './AnswerView';
import type { ConversationExchange } from './conversation-view';

export function ChatThread({
  exchanges,
  pending,
  onAsk,
  onPlanUndone,
  empty,
  className,
}: {
  exchanges: ConversationExchange[];
  pending: boolean;
  onAsk: (question: string) => void;
  onPlanUndone?: () => void;
  /** Shown while the thread has no exchanges. */
  empty: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Announce-ready region: keep the newest exchange in view.
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [exchanges]);

  return (
    <div ref={ref} className={className} aria-live="polite" aria-busy={pending} aria-label="Conversation">
      {exchanges.length === 0 && !pending && empty}

      {exchanges.map(ex => (
        <div key={ex.id} className="space-y-3">
          <div className="flex justify-end gap-3">
            <div className="max-w-[85%] px-4 py-3 rounded-card bg-primary text-primary-text text-sm">{ex.question}</div>
            <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
              <User size={15} aria-hidden="true" />
            </div>
          </div>

          {ex.pending && <AnswerPending />}

          {ex.failed && (
            <Card className="p-4">
              <ErrorState
                title="The question could not be answered"
                message={`${ex.failed} Nothing was computed and no health data left this machine.`}
                onRetry={() => onAsk(ex.question)}
              />
            </Card>
          )}

          {ex.response && <AnswerView response={ex.response} onFollowUp={onAsk} onPlanUndone={onPlanUndone} />}
        </div>
      ))}
    </div>
  );
}

/** A suggested question: asks it when clicked. */
export function PromptChip({ prompt, onAsk }: { prompt: string; onAsk: (question: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAsk(prompt)}
      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-surface-muted text-text-secondary hover:text-text-primary rounded-full transition-colors min-h-[44px]"
    >
      <Sparkles size={12} className="shrink-0" aria-hidden="true" />
      {prompt}
    </button>
  );
}
