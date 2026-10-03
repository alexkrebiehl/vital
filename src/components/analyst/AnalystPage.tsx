'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { AlertCircle, Bot } from 'lucide-react';
import { PageHero } from '@/components/art/PageHero';
import { Badge, Card } from '@/components/ui/primitives';
import { SUPPORTED_PROMPTS } from '@/lib/analyst/prompts';
import type { ConversationSummary } from '@/lib/analyst/conversation-types';
import { ConversationSelector } from './ConversationSelector';
import { ChatComposer } from './ChatComposer';
import { ChatThread, PromptChip } from './ChatThread';
import { exchangesFromMessages } from './conversation-view';
import { useAnalystChat } from './useAnalystChat';
import { useConversations } from './useConversations';
import { providerBadge, useAnalystConfig } from './useAnalystConfig';
import { parseConversationId } from '@/lib/analyst/conversation-rules';

export function AnalystPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  // ?c=<id> reopens a stored conversation, so a refresh lands back on it.
  const initialConversation = parseConversationId(searchParams.get('c'));
  const { state: configState, error: configError } = useAnalystConfig();

  // Whether a provider is actually configured decides the copy and the controls.
  // An unknown state is never reported as "no provider configured".
  const providerReady = configState?.configured === true;
  const misconfigured = configState?.misconfigured === true;
  const demoMode = configState ? !providerReady && !misconfigured : false;

  const started = useRef(false);

  // ── Conversations ───────────────────────────────────────
  // The list and the turns come from the server, so the history survives a
  // refresh, a different browser and a different device.
  const {
    availability,
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refresh: refreshConversations,
    load: loadConversation,
    rename: renameConversation,
    remove: deleteConversation,
  } = useConversations();

  // The turn belongs to a conversation now: point the address at it and refresh
  // the list so the selector shows it without a reload.
  const handleConversation = useCallback(
    (conversation: ConversationSummary) => {
      syncAddress(conversation.id);
      void refreshConversations();
    },
    [refreshConversations]
  );
  const { exchanges, pending, activeId, ask, replace, stop, reset } = useAnalystChat({ onConversation: handleConversation });

  /** Start fresh: an empty view. The server creates the conversation on the
   *  first question, so it is named after that question rather than "New". */
  const startNewConversation = useCallback(() => {
    reset();
    syncAddress(null);
  }, [reset]);

  /** Load a stored conversation and rebuild what was shown for each turn. */
  const openConversation = useCallback(
    async (id: number | null) => {
      if (id === null) {
        startNewConversation();
        return;
      }
      const detail = await loadConversation(id);
      if (!detail) {
        // Gone (deleted, or another database): do not keep pointing at it.
        syncAddress(null);
        return;
      }
      replace(detail.id, exchangesFromMessages(detail.messages));
      syncAddress(detail.id);
    },
    [loadConversation, startNewConversation, replace]
  );

  const handleRename = useCallback(
    (id: number, title: string) => {
      void renameConversation(id, title);
    },
    [renameConversation]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      const removed = await deleteConversation(id);
      if (removed && id === activeId) {
        reset();
        syncAddress(null);
      }
    },
    [deleteConversation, activeId, reset]
  );

  // /analyst?q=… runs the question once: q leaves the address as it is sent,
  // and ?c=<id> takes its place when the server has stored the turn, so a
  // refresh reopens the conversation instead of asking again.
  // /analyst?c=<id> (no q) reopens that conversation.
  useEffect(() => {
    if (started.current) return;
    if (initialQuery.trim()) {
      started.current = true;
      syncAddress(null);
      void ask(initialQuery.trim());
    } else if (initialConversation !== null) {
      started.current = true;
      void openConversation(initialConversation);
    }
  }, [initialQuery, initialConversation, ask, openConversation]);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────── */}
      <PageHero
        title="Ask about your health"
        eyebrow="AI Analyst"
        category="overview"
        seed={42}
        subtitle="Ask about the patterns in your health data."
        aside={
          <Badge variant={providerReady ? 'accent' : 'default'} className="text-xs">
            {providerBadge(configState)}
          </Badge>
        }
      />

      {/* State notice: rendered only when there is something to say. */}
      {(configError || !configState || !availability.available || demoMode || misconfigured) && (
      <Card variant="accent" className="p-4" as="section">
        <div className="flex items-start gap-2 text-xs text-primary">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="leading-relaxed space-y-1">
            {configError && (
              <p>
                <strong className="font-medium">Provider state unavailable.</strong> {configError} Nothing is assumed in
                its place: {demoMode ? 'the analyst is answering from your dataset' : 'the state stays unknown until it can be read'}.
              </p>
            )}
            {!configError && !configState && <p>Reading the analyst provider state…</p>}
            {!availability.available && (
              <p>
                <strong className="font-medium">Conversations are not being saved.</strong>{' '}
                {availability.reason ??
                  'No database is configured, so this conversation lives in this browser tab only and will not survive a refresh.'}
              </p>
            )}
            {demoMode && (
              <p>
                <strong className="font-medium">Demo analyst.</strong> No AI provider is configured, so nothing is
                generated by a model. Each supported question is answered by a deterministic handler that computes its
                figures from your dataset at request time, and every figure carries its metric, window, aggregation and
                sample count. Questions outside the supported set are reported as unsupported rather than guessed at.
              </p>
            )}
            {misconfigured && (
              <p>
                <strong className="font-medium">{configState?.providerDisplayName} is misconfigured.</strong>{' '}
                {configState?.misconfiguredReason} No request is sent and no answer is produced until the server
                environment is fixed; the analyst does not fall back to demo answers.
              </p>
            )}
          </div>
        </div>
      </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 items-start">
        {/* ── Conversation selector ──────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <ConversationSelector
            availability={availability}
            conversations={conversations}
            activeId={activeId}
            loading={conversationsLoading}
            error={conversationsError}
            onSelect={id => void openConversation(id)}
            onCreate={startNewConversation}
            onRename={handleRename}
            onDelete={id => void handleDelete(id)}
            onRefresh={() => void refreshConversations()}
          />
        </div>

        {/* ── Conversation ─────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          <ChatThread
            exchanges={exchanges}
            pending={pending}
            onAsk={q => void ask(q)}
            className="space-y-5 max-h-[56vh] lg:max-h-[58vh] overflow-y-auto pr-2"
            empty={
              <Card className="p-6 text-center">
                <Bot size={32} className="mx-auto text-text-secondary mb-3" aria-hidden="true" />
                <p className="text-sm text-text-primary font-medium mb-1">Ask a question about your health data</p>
                <p className="text-xs text-text-secondary mb-4">
                  {providerReady
                    ? 'Ask anything about your sleep, recovery, activity or trends. The prompts below are examples.'
                    : `${SUPPORTED_PROMPTS.length} questions are wired to handlers in this build. Pick one below or type it yourself.`}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUPPORTED_PROMPTS.map(q => (
                    <PromptChip key={q} prompt={q} onAsk={q => void ask(q)} />
                  ))}
                </div>
              </Card>
            }
          />

          {/* ── Composer ─────────────────────────────── */}
          <ChatComposer onSend={q => void ask(q)} onStop={stop} pending={pending} providerReady={providerReady} />
        </div>

      </div>

      {/* ── Educational notice ─────────────────────── */}
      <p className="text-[11px] text-text-secondary text-center leading-relaxed max-w-2xl mx-auto">
        This tool interprets your personal health data for informational purposes only. It does not diagnose, treat or
        rule anything out, and it is not a substitute for advice from a qualified healthcare provider. Association does
        not establish causation, and a personal baseline is not a medical reference range.
      </p>
    </div>
  );
}

/**
 * Keep the address in step with the view: drop a consumed ?q= and point ?c= at
 * the open conversation (or remove it). replaceState integrates with the App
 * Router's useSearchParams and adds no history entry.
 */
function syncAddress(conversationId: number | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  if (conversationId === null) url.searchParams.delete('c');
  else url.searchParams.set('c', String(conversationId));
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, '', next);
}
