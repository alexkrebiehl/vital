'use client';

// ── Analyst answer (SPEC §8) ────────────────────────────
//
// One analyst turn as the reader sees it: the prose analysis and the sections
// after it, charts, evidence cards, grounding audit, plan change and follow-ups
// — or, with no answer, why.
// Shared by the AI Analyst page and the "Discuss with analyst" dialog.

import Link from 'next/link';
import { Bot, ChevronRight, Loader2, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { PlanChangeCard } from '@/components/routine/shared';
import type { AnalystAnswer, AnalystResponse } from '@/lib/analyst/types';
import { partialAnswer } from '@/lib/analyst/partial-answer';

// ── Pending state ──────────────────────────────────────

/**
 * Waiting for the first bytes of the answer: three dots that swell in turn,
 * with what is happening beside them when there is something to say (a plan
 * tool running). Under reduced motion the dots hold still.
 */
export function AnswerPending({ label }: { label?: string }) {
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
        <span className="flex items-center gap-1" aria-hidden="true">
          {[0, 160, 320].map(delay => (
            <span
              key={delay}
              className="h-2 w-2 rounded-full bg-text-secondary animate-typing-dot"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        {label ? (
          <span className="text-[11px] text-text-secondary break-words">{label}</span>
        ) : (
          <span className="sr-only">Waiting for the analyst answer</span>
        )}
      </div>
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

const DATA_LOOKUPS: Record<string, string> = {
  get_metrics: 'Looking up your metrics…',
  compare_periods: 'Comparing two periods…',
  get_metric_series: 'Looking up your metric series…',
  get_metric_relationship: 'Checking how two metrics move together…',
  get_workouts: 'Looking up your workouts…',
  get_sleep: 'Looking up your sleep…',
  get_blood_pressure: 'Looking up your blood pressure…',
  get_lab_results: 'Looking up your lab results…',
  compare_lab_panels: 'Comparing your lab panels…',
  get_medications: 'Looking up your medication log…',
};

/** A tool as a status line: a data lookup in plain words, a plan tool as "Using the plan tool: get routine progress…". */
export function toolStatus(tool: string): string {
  return DATA_LOOKUPS[tool] ?? `Using the plan tool: ${tool.replace(/_/g, ' ')}…`;
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
      <AnswerText answer={partial} />
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

        <AnswerText answer={answer} />

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

/** The parts of an answer drawn as text, whole or still streaming. */
type AnswerTextParts = Pick<AnalystAnswer, 'analysis' | 'recommendations' | 'summary' | 'uncertainty'> &
  Partial<Pick<AnalystAnswer, 'observed' | 'interpretation'>>;

/**
 * The prose analysis, then the sections that follow it.
 *
 * An answer with no analysis — a demo handler's, or one stored before answers
 * had prose — reads its observed and interpretation lines as the body instead,
 * so it is not left showing only its caveats.
 */
function AnswerText({ answer }: { answer: AnswerTextParts }) {
  const paragraphs = answer.analysis.trim()
    ? answer.analysis
        .split(/\n{2,}/)
        .map(paragraph => paragraph.trim())
        .filter(paragraph => paragraph.length > 0)
    : [...(answer.observed ?? []), ...(answer.interpretation ?? [])];
  return (
    <>
      {paragraphs.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-[0.06em] font-medium text-text-secondary">Analysis</h3>
          <div className="space-y-3">
            {paragraphs.map((paragraph, i) => (
              <p key={i} className="text-sm text-text-primary leading-relaxed break-words">
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
              <p className="text-sm text-text-primary leading-relaxed break-words">
                {withLinks(lines[0]!, `${section.heading}-0`)}
              </p>
            ) : section.prose ? (
              // A section declared as prose is joined into one paragraph.
              <p className="text-sm text-text-primary leading-relaxed break-words">
                {withLinks(lines.join(' '), section.heading)}
              </p>
            ) : (
              <ul className="list-disc pl-5 space-y-1.5">
                {lines.map((line, i) => (
                  <li key={i} className="text-sm text-text-primary leading-relaxed break-words">
                    {withLinks(line, `${section.heading}-${i}`)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

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
const ANSWER_SECTIONS: { heading: string; pick: (a: AnswerTextParts) => string[]; prose?: boolean }[] = [
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
