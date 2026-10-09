// ── The result envelope (design §6) ─────────────────────
//
// Pure. Every capability answers with one of five statuses; `next` is one
// sentence written for the model. An empty window is an answer, not an error.

import { safeExcerpt } from '../scrub';
import type { CapabilityManifestEntry, Coverage } from './types';

export type Status = 'ok' | 'no_data_in_window' | 'source_unavailable' | 'privacy_blocked' | 'invalid_args';

export interface EnvelopeWindow {
  start: string;
  end: string;
  asked: string;
  clipped?: string;
}

export interface EnvelopePage {
  returned: number;
  total: number;
  offset: number;
  nextOffset?: number;
  how?: string;
}

export interface Envelope<R> {
  status: Status;
  capability: string;
  window?: EnvelopeWindow;
  coverage?: Coverage;
  data?: R;
  page?: EnvelopePage;
  /** One sentence, written for the model: what to do next. */
  next?: string;
  /** invalid_args only. */
  problems?: string[];
}

type Cap = Pick<CapabilityManifestEntry, 'id' | 'title'>;

/** isError is true for every status except ok and an empty window. */
export function isErrorStatus(status: Status): boolean {
  return status !== 'ok' && status !== 'no_data_in_window';
}

export function ok<R>(cap: Pick<CapabilityManifestEntry, 'id'>, data: R, extra: { window?: EnvelopeWindow; coverage?: Coverage; page?: EnvelopePage; next?: string } = {}): Envelope<R> {
  return {
    status: 'ok',
    capability: cap.id,
    ...(extra.window ? { window: extra.window } : {}),
    ...(extra.coverage ? { coverage: extra.coverage } : {}),
    data,
    ...(extra.page ? { page: extra.page } : {}),
    ...(extra.next ? { next: extra.next } : {}),
  };
}

/** A reason as a clause: scrubbed, one line, no closing full stop (the sentence adds its own). */
const clause = (reason: string): string => safeExcerpt(reason).replace(/[.\s]+$/, '');

function holds(coverage: Coverage): string {
  if (coverage.kind === 'unknown') return `What else the app holds is unknown: ${clause(coverage.reason)}.`;
  if (coverage.kind === 'unavailable') return `What the app holds could not be checked: ${clause(coverage.reason)}.`;
  if (coverage.count === 0 || coverage.first === null || coverage.last === null) return 'The app holds none at all.';
  return `The app holds ${coverage.count} ${coverage.unit} from ${coverage.first} to ${coverage.last}.`;
}

export function noDataInWindow(cap: Cap, window: EnvelopeWindow, coverage: Coverage): Envelope<never> {
  return {
    status: 'no_data_in_window',
    capability: cap.id,
    window,
    coverage,
    next: `No ${cap.title} between ${window.start} and ${window.end}. ${holds(coverage)}`,
  };
}

export function sourceUnavailable(cap: Cap, reason: string): Envelope<never> {
  return {
    status: 'source_unavailable',
    capability: cap.id,
    next: `${cap.title} could not be read: ${clause(reason)}. This says nothing about whether records exist.`,
  };
}

export function privacyBlocked(cap: Cap): Envelope<never> {
  return { status: 'privacy_blocked', capability: cap.id, next: `${cap.title} is withheld from the model by the AI privacy setting.` };
}

/** `extra` carries the hints a retry needs: didYouMean, typesInWindow, panelDates. */
export function invalidArgs(cap: Pick<CapabilityManifestEntry, 'id'>, problems: string[], extra?: Record<string, unknown>): Envelope<Record<string, unknown>> {
  const mean = Array.isArray(extra?.didYouMean) && extra.didYouMean.length ? ` Did you mean: ${extra.didYouMean.join(', ')}?` : '';
  return {
    status: 'invalid_args',
    capability: cap.id,
    ...(extra && Object.keys(extra).length ? { data: extra } : {}),
    next: `Fix the arguments and call again. ${problems.join(' ')}${mean}`,
    problems,
  };
}

export interface PageOptions<T, V> {
  limit: number;
  offset: number;
  /** The most JSON characters the returned rows may take together. */
  maxChars: number;
  /** Shapes a row before it is measured; default is the row itself. */
  render?: (row: T) => V;
}

/**
 * The rows from `offset` that fit under both `limit` and `maxChars`. A row is
 * kept whole or left out. One row larger than the budget is still returned
 * alone: returning none would leave the caller nothing to page past.
 */
export function pageRows<T, V = T>(rows: readonly T[], opts: PageOptions<T, V>): { rows: V[]; page: EnvelopePage } {
  const render = opts.render ?? ((r: T) => r as unknown as V);
  const out: V[] = [];
  let chars = 2; // the enclosing [ ]
  for (let i = opts.offset; i < rows.length && out.length < opts.limit; i++) {
    const row = render(rows[i]);
    const cost = JSON.stringify(row).length + (out.length ? 1 : 0);
    if (out.length > 0 && chars + cost > opts.maxChars) break;
    out.push(row);
    chars += cost;
  }
  const end = opts.offset + out.length;
  const page: EnvelopePage = { returned: out.length, total: rows.length, offset: opts.offset };
  if (end < rows.length && out.length > 0) {
    page.nextOffset = end;
    page.how = `${out.length} of ${rows.length} shown. Call again with offset ${end} for more, or use view: summary.`;
  }
  return { rows: out, page };
}
