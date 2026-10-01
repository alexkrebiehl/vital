'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bot, ChevronRight, Loader2, Send, ShieldCheck, Sparkles, User,
} from 'lucide-react';
import { PageHero } from '@/components/art/PageHero';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { SUPPORTED_PROMPTS } from '@/lib/analyst/prompts';
import type { AnalystAnswer, AnalystResponse } from '@/lib/analyst/types';
import type { ConversationAvailability, ConversationSummary } from '@/lib/analyst/conversation-types';
import { ConversationSelector } from './ConversationSelector';
import { exchangesFromMessages, type ConversationExchange } from './conversation-view';
import { askAnalystStreaming, askWithStreamingFallback } from './stream-client';
import { useConversations } from './useConversations';
import { providerBadge, useAnalystConfig } from './useAnalystConfig';

/** The ask endpoint's response: the answer plus what happened to the turn. */
interface AskResponse extends AnalystResponse {
  persisted?: boolean;
  persistence?: ConversationAvailability;
  conversation?: ConversationSummary | null;
}

type Exchange = ConversationExchange & {
  /** Reasoning streamed so far for this turn; display only, never the answer. */
  reasoning?: string;
  /** Answer text streamed so far, before validation. Cleared on the final result. */
  streamingText?: string;
  /** True while the answer is being streamed (as opposed to awaiting a result). */
  streaming?: boolean;
};

export function AnalystPage() {
  const { units } = useUnits();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const { state: configState, error: configError } = useAnalystConfig();

  // Whether a provider is actually configured decides the copy and the controls.
  // An unknown state is never reported as "no provider configured".
  const providerReady = configState?.configured === true;
  const misconfigured = configState?.misconfigured === true;
  const demoMode = configState ? !providerReady && !misconfigured : false;

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const conversationRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  /** Aborts the in-flight streamed ask when the page unmounts. */
  const abortRef = useRef<AbortController | null>(null);

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
  const [activeId, setActiveId] = useState<number | null>(null);

  /** The non-streaming fallback: one POST /api/analyst and the whole response. */
  const askNonStreaming = useCallback(
    async (question: string, id: number) => {
      const res = await fetch('/api/analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A null conversation means "a new one": the server creates it and
        // titles it from this question.
        body: JSON.stringify({ query: question, system: units, conversationId: activeId }),
      });
      if (!res.ok) throw new Error(`The analyst endpoint answered HTTP ${res.status}.`);
      const data = (await res.json()) as AskResponse;
      setExchanges(prev =>
        prev.map(e => (e.id === id ? { ...e, response: data, pending: false, streaming: false, streamingText: '' } : e))
      );
      // The turn belongs to a conversation now: adopt it and refresh the list
      // so the selector shows it without a reload.
      if (data.conversation) {
        setActiveId(data.conversation.id);
        void refreshConversations();
      }
    },
    [units, activeId, refreshConversations]
  );

  const ask = useCallback(
    async (question: string) => {
      const id = nextId.current++;
      const controller = new AbortController();
      abortRef.current = controller;
      setExchanges(prev => [
        ...prev,
        { id, question, response: null, pending: true, streaming: true, reasoning: '', streamingText: '', failed: null },
      ]);
      setPending(true);
      try {
        // The streaming path shows reasoning and answer as they arrive. Any
        // failure falls back to the non-streaming endpoint so the user still gets
        // an answer rather than a dead turn.
        await askWithStreamingFallback(
          () =>
            askAnalystStreaming(
              { query: question, system: units, conversationId: activeId },
              {
                onReasoning: text =>
                  setExchanges(prev =>
                    prev.map(e => (e.id === id ? { ...e, reasoning: (e.reasoning ?? '') + text } : e))
                  ),
                onAnswer: text =>
                  setExchanges(prev =>
                    prev.map(e => (e.id === id ? { ...e, streamingText: `${e.streamingText ?? ''}${text}` } : e))
                  ),
                onResult: response => {
                  const data = response as AskResponse;
                  setExchanges(prev =>
                    prev.map(e =>
                      e.id === id ? { ...e, response: data, pending: false, streaming: false, streamingText: '' } : e
                    )
                  );
                  if (data.conversation) {
                    setActiveId(data.conversation.id);
                    void refreshConversations();
                  }
                },
              },
              controller.signal
            ),
          () => askNonStreaming(question, id)
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setExchanges(prev =>
          prev.map(e =>
            e.id === id
              ? {
                  ...e,
                  pending: false,
                  streaming: false,
                  failed: error instanceof Error ? error.message : 'The question could not be sent.',
                }
              : e
          )
        );
      } finally {
        abortRef.current = null;
        setPending(false);
      }
    },
    [units, activeId, refreshConversations, askNonStreaming]
  );

  /** Start fresh: an empty view. The server creates the conversation on the
   *  first question, so it is named after that question rather than "New". */
  const startNewConversation = useCallback(() => {
    setActiveId(null);
    setExchanges([]);
  }, []);

  /** Load a stored conversation and rebuild what was shown for each turn. */
  const openConversation = useCallback(
    async (id: number | null) => {
      if (id === null) {
        startNewConversation();
        return;
      }
      const detail = await loadConversation(id);
      if (!detail) return;
      setActiveId(detail.id);
      setExchanges(exchangesFromMessages(detail.messages));
    },
    [loadConversation, startNewConversation]
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
        setActiveId(null);
        setExchanges([]);
      }
    },
    [deleteConversation, activeId]
  );

  // /analyst?q=… prefills and runs the question.
  useEffect(() => {
    if (started.current || !initialQuery.trim()) return;
    started.current = true;
    void ask(initialQuery.trim());
  }, [initialQuery, ask]);

  useEffect(() => {
    // Announce-ready region: keep the newest exchange in view.
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' });
  }, [exchanges]);

  // A page that unmounts mid-stream cancels its own upstream request.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = () => {
    const question = input.trim();
    if (!question || pending) return;
    setInput('');
    void ask(question);
  };

  const lastResponse = useMemo(
    () => [...exchanges].reverse().find(e => e.response)?.response ?? null,
    [exchanges]
  );

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
          <div
            ref={conversationRef}
            className="space-y-5 max-h-[56vh] lg:max-h-[58vh] overflow-y-auto pr-2"
            aria-live="polite"
            aria-busy={pending}
            aria-label="Conversation"
          >
            {exchanges.length === 0 && !pending && (
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
                    <button
                      key={q}
                      type="button"
                      onClick={() => void ask(q)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-surface-muted text-text-secondary hover:text-text-primary rounded-full transition-colors min-h-[44px]"
                    >
                      <Sparkles size={12} aria-hidden="true" />
                      {q}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {exchanges.map(ex => (
              <div key={ex.id} className="space-y-3">
                <div className="flex justify-end gap-3">
                  <div className="max-w-[85%] px-4 py-3 rounded-card bg-primary text-primary-text text-sm">
                    {ex.question}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
                    <User size={15} aria-hidden="true" />
                  </div>
                </div>

                {ex.pending && (
                  <>
                    {ex.reasoning ? (
                      <ReasoningBlock reasoning={ex.reasoning} />
                    ) : (
                      <AnswerPending />
                    )}
                    {ex.streamingText ? (
                      <Card className="flex-1 p-4 space-y-3" variant="muted">
                        <StatusHint text="Streaming the answer…" />
                        <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{ex.streamingText}</p>
                      </Card>
                    ) : null}
                  </>
                )}

                {!ex.pending && ex.failed && (
                  <Card className="p-4">
                    <ErrorState
                      title="The question could not be answered"
                      message={`${ex.failed} Nothing was computed and no health data left this machine.`}
                      onRetry={() => void ask(ex.question)}
                    />
                  </Card>
                )}

                {!ex.pending && ex.reasoning && <ReasoningBlock reasoning={ex.reasoning} />}

                {ex.response && <AnswerView response={ex.response} onFollowUp={q => void ask(q)} />}
              </div>
            ))}
          </div>

          {/* ── Composer ─────────────────────────────── */}
          <div className="flex items-end gap-2 p-2 bg-surface border border-border rounded-control">
            <label className="flex-1">
              <span className="sr-only">Ask a question about your health data</span>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  providerReady
                    ? 'Ask anything about your sleep, recovery, activity…'
                    : 'Ask about your sleep, recovery, activity…'
                }
                className="w-full bg-transparent border-none outline-none px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary"
                maxLength={400}
                aria-describedby="composer-state"
              />
            </label>
            <Button
              variant="primary"
              size="md"
              onClick={handleSend}
              disabled={!input.trim() || pending}
              aria-label={pending ? 'Sending your question' : 'Send your question'}
            >
              {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              <span className="ml-1.5">{pending ? 'Working' : 'Send'}</span>
            </Button>
          </div>
          <p id="composer-state" className="text-[11px] text-text-secondary">
            {pending
              ? providerReady
                ? 'Waiting for the configured provider to answer…'
                : 'Answering from your dataset…'
              : input.trim()
                ? 'Press Send or Enter to ask.'
                : 'Enter a question to enable Send. Questions are limited to 400 characters.'}
          </p>
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

// ── Pending state ──────────────────────────────────────

/** A small status line: a spinner plus a plain-language state. */
function StatusHint({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-text-secondary" role="status" aria-live="polite">
      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
      {text}
    </p>
  );
}

/**
 * The model's streamed reasoning, in a COLLAPSED-BY-DEFAULT block.
 *
 * It is labelled plainly as "Reasoning" and is deliberately NOT the answer: the
 * answer arrives separately and is the only thing that is validated. `<details>`
 * gives collapse for free, so it works without JavaScript state and is reachable
 * by keyboard.
 */
function ReasoningBlock({ reasoning }: { reasoning: string }) {
  if (!reasoning.trim()) return null;
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <details className="flex-1 rounded-card border border-border bg-surface-muted/40 group">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] text-text-secondary select-none">
          <ChevronRight size={12} className="transition-transform group-open:rotate-90" aria-hidden="true" />
          Reasoning <span className="text-text-secondary/70">(the model&apos;s own working, not the answer)</span>
        </summary>
        <p className="px-3 pb-3 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{reasoning}</p>
      </details>
    </div>
  );
}

function AnswerPending() {
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <Card className="flex-1 p-4 space-y-3" variant="muted">
        <span className="sr-only">Waiting for the analyst answer</span>
        <Skeleton height={14} width="40%" />
        <Skeleton height={12} width="90%" />
        <Skeleton height={12} width="80%" />
        <Skeleton height={56} />
      </Card>
    </div>
  );
}

// ── Answer ─────────────────────────────────────────────

function AnswerView({ response, onFollowUp }: { response: AnalystResponse; onFollowUp: (q: string) => void }) {
  const answer = response.answer;

  if (!answer) {
    return (
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
          <Bot size={15} aria-hidden="true" />
        </div>
        <Card className="flex-1 p-4" variant="muted">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="warning" className="text-[10px]">
              {STATUS_LABEL[response.status] ?? 'No answer'}
            </Badge>
          </div>
          <p className="text-sm text-text-primary mb-3">{response.message}</p>
          <p className="text-[11px] text-text-secondary mb-2">Supported questions:</p>
          <div className="flex flex-wrap gap-2">
            {response.suggested.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className="px-3 py-2 text-xs rounded-full bg-surface text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
              >
                {q}
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <Card className="flex-1 p-4 space-y-4" as="article">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" className="text-[10px]">{response.label}</Badge>
          <span className="text-[11px] text-text-secondary">
            {response.providerConfigured ? (
              <>
                generated by <code>{response.model ?? 'the configured model'}</code> via {response.providerDisplayName},
                validated against the selected context
              </>
            ) : (
              <>
                computed by handler <code>{response.handlerId}</code>
              </>
            )}
          </span>
        </div>

        <h2 className="text-base font-semibold text-text-primary">{answer.title}</h2>

        {answer.analysis.trim().length > 0 && (
          <section className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-[0.06em] font-medium text-text-secondary">Analysis</h3>
            <div className="space-y-3">
              {answer.analysis
                .split(/\n{2,}/)
                .map(paragraph => paragraph.trim())
                .filter(paragraph => paragraph.length > 0)
                .map((paragraph, i) => (
                  <p key={i} className="text-sm text-text-primary leading-relaxed">
                    {withLinks(paragraph, `p${i}`)}
                  </p>
                ))}
            </div>
          </section>
        )}

        {ANSWER_SECTIONS.map(section => {
          const lines = section.pick(answer);
          if (lines.length === 0) return null;
          return (
            <section key={section.heading}>
              <h3 className="text-[11px] uppercase tracking-[0.06em] font-medium text-text-secondary mb-1.5">{section.heading}</h3>
              {lines.length === 1 ? (
                // One line is a statement, not a list: draw it as text so the
                // answer reads as prose with a paragraph, not as a bulleted page.
                <p className="text-sm text-text-primary leading-relaxed">
                  {withLinks(lines[0]!, `${section.heading}-0`)}
                </p>
              ) : section.prose ? (
                // A section declared as prose is joined into one paragraph.
                <p className="text-sm text-text-primary leading-relaxed">
                  {withLinks(lines.join(' '), section.heading)}
                </p>
              ) : (
                <ul className="list-disc pl-5 space-y-1.5">
                  {lines.map((line, i) => (
                    <li key={i} className="text-sm text-text-primary leading-relaxed">
                      {withLinks(line, `${section.heading}-${i}`)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {answer.charts.length > 0 && (
          <div className="space-y-3">
            {answer.charts.slice(0, 2).map(chart => (
              <TrendFigure
                key={`${chart.metricId}-${chart.caption}`}
                metricId={chart.metricId}
                data={chart.points}
                caption={chart.caption}
                height={72}
              />
            ))}
          </div>
        )}

        {answer.evidence.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.06em] font-medium text-text-secondary">Evidence</h3>
            {answer.evidence.map((ev, i) => (
              <div key={`${ev.metricId}-${i}`} className="border border-border rounded-control p-3">
                <div className="flex flex-wrap items-baseline gap-2 mb-1">
                  <Badge variant="default" className="text-[10px]">Metric</Badge>
                  <span className="text-sm font-medium text-text-primary">{ev.metricName}</span>
                </div>
                <dl className="text-[11px] text-text-secondary space-y-0.5">
                  <EvRow label="Window" value={ev.windowLabel} />
                  <EvRow label="Aggregation" value={ev.aggregation} />
                  <EvRow label="Sample count" value={ev.sampleCount} />
                </dl>
                <Link href={ev.href} className="inline-block mt-2 text-xs text-primary hover:underline">
                  Open the underlying chart or records
                </Link>
              </div>
            ))}
          </div>
        )}

        {response.grounding.unmatched.length > 0 && (
          <div className="rounded-control border border-category-attention/40 p-3">
            <p className="text-[11px] text-category-attention leading-relaxed">
              These figures were not found in the selected context: {response.grounding.unmatched.join(', ')}. They are
              shown as the model wrote them rather than removed, so you can see exactly which claims are unverified.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 pt-1">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <p className="text-[11px] text-text-secondary leading-relaxed">{answer.boundaryNote}</p>
        </div>

        {answer.followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {answer.followUps.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className="px-3 py-2 text-xs rounded-full bg-surface-muted text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  unsupported: 'Not supported',
  misconfigured: 'Provider misconfigured',
  error: 'Provider error',
  ok: 'Answer',
};

/**
 * The supporting lists that follow the prose analysis. Each is a SHORT list — the
 * prose carries the reasoning, so these are the facts, the next steps and the
 * caveats, not the argument.
 */
/**
 * The sections that follow the prose.
 *
 * There is deliberately NO "measured" list: the values are already on their own
 * pages and the analysis links to them, so restating them here would be the
 * machine dump the owner objected to. The evidence cards below the answer carry
 * the links to the underlying charts and records.
 *
 * `prose: true` joins the entries into ONE paragraph instead of a bullet list —
 * uncertainty is a statement about the answer, so it reads as text; the next steps
 * are genuinely a list of actions, so they stay a list.
 */
const ANSWER_SECTIONS: { heading: string; pick: (a: AnalystAnswer) => string[]; prose?: boolean }[] = [
  { heading: 'What to do next', pick: a => a.recommendations },
  { heading: 'Summary', pick: a => a.summary, prose: true },
  { heading: 'Missing context and uncertainty', pick: a => a.uncertainty, prose: true },
];

/**
 * Render a line that may carry inline link tokens — `[haemoglobin](/metric/hemoglobin)`.
 *
 * The model is asked to POINT at a measurement rather than recite it, so the
 * answer's prose names the metric and the reader clicks through to the value. Only
 * same-origin routes are turned into links: anything else is shown as plain text,
 * because the token comes from model output.
 */
const LINK_TOKEN = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

function withLinks(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  LINK_TOKEN.lastIndex = 0;
  while ((match = LINK_TOKEN.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, label, href] = match;
    nodes.push(
      <Link
        key={`${keyPrefix}-${match.index}`}
        href={href}
        className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {label}
      </Link>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function EvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tnum text-text-primary text-right">{value}</dd>
    </div>
  );
}
