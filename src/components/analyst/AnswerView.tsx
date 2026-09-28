'use client';

// ── Analyst answer (SPEC §8) ────────────────────────────
//
// One analyst turn as the reader sees it: the three sections, charts, evidence
// cards, grounding audit, plan change and follow-ups — or, with no answer, why.
// Shared by the AI Analyst page and the "Discuss with analyst" dialog.

import Link from 'next/link';
import { Bot, ChevronRight, Loader2, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { PlanChangeCard } from '@/components/routine/shared';
import type { AnalystAnswer, AnalystResponse } from '@/lib/analyst/types';
import { partialAnswer } from '@/lib/analyst/partial-answer';

// ── Pending state ──────────────────────────────────────

export function AnswerPending() {
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

/** A small status line: a spinner plus a plain-language state. */
export function StatusHint({ text }: { text: string }) {
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
export function ReasoningBlock({ reasoning }: { reasoning: string }) {
  if (!reasoning.trim()) return null;
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <details className="flex-1 min-w-0 rounded-card border border-border bg-surface-muted/40 group">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] text-text-secondary select-none">
          <ChevronRight size={12} className="transition-transform group-open:rotate-90" aria-hidden="true" />
          Reasoning <span className="text-text-secondary/70">(the model&apos;s own working, not the answer)</span>
        </summary>
        <p className="px-3 pb-3 text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed">{reasoning}</p>
      </details>
    </div>
  );
}

/** A plan tool as a status line: "get_routine_progress" → "Using the plan tool: get routine progress…". */
export function toolStatus(tool: string): string {
  return `Using the plan tool: ${tool.replace(/_/g, ' ')}…`;
}

/**
 * The answer while it streams, laid out like the finished answer: the title
 * and each section's lines appear as they arrive instead of the raw JSON.
 * Display only — the validated answer replaces it when the result comes.
 */
export function StreamingAnswer({ text }: { text: string }) {
  const partial = partialAnswer(text);
  const body = partial ? (
    <>
      {partial.title ? (
        <h2 className="text-base font-semibold text-text-primary">{partial.title}</h2>
      ) : (
        <Skeleton height={14} width="40%" />
      )}
      {ANSWER_SECTIONS.map(section => {
        const lines = section.pick(partial);
        if (lines.length === 0) return null;
        return (
          <section key={section.heading}>
            <h3 className="text-[10px] uppercase tracking-wider text-text-secondary mb-1.5">{section.heading}</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              {lines.map((line, i) => (
                <li key={i} className="text-sm text-text-primary leading-relaxed break-words">{line}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  ) : text.trimStart().startsWith('`') ? (
    // An opening code fence: the JSON has not started yet.
    <Skeleton height={14} width="40%" />
  ) : (
    // Not the JSON answer (yet): a preamble before a tool call, or prose the
    // server will ask for again in the required shape.
    <p className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">{text}</p>
  );
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <Card className="flex-1 min-w-0 p-4 space-y-4" as="article">
        <StatusHint text="Writing the answer…" />
        {body}
      </Card>
    </div>
  );
}

// ── Answer ─────────────────────────────────────────────

/** The provider refused the plan tools, so the answer was made without them. */
function ToolsUnavailableNote({ text }: { text: string }) {
  return (
    <p role="note" className="flex items-start gap-1.5 rounded-control bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-3 py-2 text-xs">
      <Wrench size={13} className="shrink-0 mt-px" aria-hidden="true" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

export function AnswerView({
  response,
  onFollowUp,
  onPlanUndone,
}: {
  response: AnalystResponse;
  onFollowUp: (q: string) => void;
  /** Called after the reader undoes this answer's plan change. */
  onPlanUndone?: () => void;
}) {
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
          {response.toolsUnavailable && (
            <div className="mb-3">
              <ToolsUnavailableNote text={response.toolsUnavailable} />
            </div>
          )}
          {response.planChange && (
            <div className="mb-3">
              <PlanChangeCard change={response.planChange} onUndone={onPlanUndone} />
            </div>
          )}
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

        {response.toolsUnavailable && <ToolsUnavailableNote text={response.toolsUnavailable} />}
        {response.planChange && <PlanChangeCard change={response.planChange} onUndone={onPlanUndone} />}
        {response.toolsUsed && response.toolsUsed.length > 0 && (
          <p className="text-[11px] text-text-secondary">
            Tools used: {[...new Set(response.toolsUsed)].map(t => t.replace(/_/g, ' ')).join(', ')}
          </p>
        )}

        {ANSWER_SECTIONS.map(section => {
          const lines = section.pick(answer);
          if (lines.length === 0) return null;
          return (
            <section key={section.heading}>
              <h3 className="text-[10px] uppercase tracking-wider text-text-secondary mb-1.5">{section.heading}</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                {lines.map((line, i) => (
                  <li key={i} className="text-sm text-text-primary leading-relaxed">{line}</li>
                ))}
              </ul>
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
            <h3 className="text-[10px] uppercase tracking-wider text-text-secondary">Evidence</h3>
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

const ANSWER_SECTIONS: { heading: string; pick: (a: Pick<AnalystAnswer, 'observed' | 'interpretation' | 'uncertainty'>) => string[] }[] = [
  { heading: '1 · Observed measurements', pick: a => a.observed },
  { heading: '2 · Possible interpretation', pick: a => a.interpretation },
  { heading: '3 · Missing context and uncertainty', pick: a => a.uncertainty },
];

function EvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tnum text-text-primary text-right">{value}</dd>
    </div>
  );
}
