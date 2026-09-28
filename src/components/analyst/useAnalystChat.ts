'use client';

// ── Analyst chat hook (SPEC §8) ─────────────────────────
//
// One thread of questions and answers against /api/analyst. The AI Analyst page
// and the "Discuss with analyst" dialog both use it, so they ask the same
// endpoint with the same tools and save to the same conversation store.
//
// A null conversation means "a new one": the server creates it on the first
// question and titles it from that question. The hook adopts it and reports it
// through `onConversation`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUnits } from '@/components/ui/UnitsProvider';
import type { AnalystResponse } from '@/lib/analyst/types';
import type { ConversationAvailability, ConversationSummary } from '@/lib/analyst/conversation-types';
import type { PageContextRef } from '@/lib/analyst/page-context-types';
import type { PlanChange } from '@/lib/routine/types';
import type { ConversationExchange } from './conversation-view';

/** The ask endpoint's response: the answer plus what happened to the turn. */
interface AskResponse extends AnalystResponse {
  persisted?: boolean;
  persistence?: ConversationAvailability;
  conversation?: ConversationSummary | null;
}

export interface AnalystChatOptions {
  /** The page the questions are asked from, resolved into page state on the server. */
  context?: PageContextRef;
  /** The turn was saved to this conversation (new or existing). */
  onConversation?: (conversation: ConversationSummary) => void;
  /** An answer changed the training plan. */
  onPlanChange?: (change: PlanChange) => void;
}

export interface AnalystChat {
  exchanges: ConversationExchange[];
  pending: boolean;
  activeId: number | null;
  ask: (question: string) => Promise<void>;
  /** Show a stored conversation (or none) in place of the current thread. */
  replace: (id: number | null, exchanges: ConversationExchange[]) => void;
  /** Start fresh: an empty thread and no conversation. */
  reset: () => void;
}

export function useAnalystChat({ context, onConversation, onPlanChange }: AnalystChatOptions = {}): AnalystChat {
  const { units } = useUnits();
  const [exchanges, setExchanges] = useState<ConversationExchange[]>([]);
  const [pending, setPending] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const nextId = useRef(1);

  // Callbacks change identity every render; the latest one is always called.
  const callbacks = useRef({ onConversation, onPlanChange });
  useEffect(() => {
    callbacks.current = { onConversation, onPlanChange };
  });

  const ask = useCallback(
    async (question: string) => {
      const id = nextId.current++;
      setExchanges(prev => [...prev, { id, question, response: null, pending: true, failed: null }]);
      setPending(true);
      try {
        const res = await fetch('/api/analyst', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: question, system: units, conversationId: activeId, context: context ?? null }),
        });
        if (!res.ok) throw new Error(`The analyst endpoint answered HTTP ${res.status}.`);
        const data = (await res.json()) as AskResponse;
        setExchanges(prev => prev.map(e => (e.id === id ? { ...e, response: data, pending: false } : e)));
        if (data.planChange) callbacks.current.onPlanChange?.(data.planChange);
        // The turn belongs to a conversation now: adopt it.
        if (data.conversation) {
          setActiveId(data.conversation.id);
          callbacks.current.onConversation?.(data.conversation);
        }
      } catch (error) {
        setExchanges(prev =>
          prev.map(e =>
            e.id === id
              ? { ...e, pending: false, failed: error instanceof Error ? error.message : 'The question could not be sent.' }
              : e
          )
        );
      } finally {
        setPending(false);
      }
    },
    [units, activeId, context]
  );

  const replace = useCallback((id: number | null, next: ConversationExchange[]) => {
    setActiveId(id);
    setExchanges(next);
  }, []);

  const reset = useCallback(() => replace(null, []), [replace]);

  return { exchanges, pending, activeId, ask, replace, reset };
}
