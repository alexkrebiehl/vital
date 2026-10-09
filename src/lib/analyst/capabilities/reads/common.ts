// ── Shared by the capability reads (SERVER ONLY) ────────
//
// Window handling and the guard every read starts with: the privacy check, then
// the work, with a thrown reader error reported as source_unavailable (scrubbed),
// never as an empty answer. No module-level state: a read looks at the dataset the
// route installed for this question.

import { containsDay, diffDays, type DayWindow } from '../../../analytics/windows';
import { scrubForModel } from '../../scrub';
import { invalidArgs, noDataInWindow, privacyBlocked, sourceUnavailable, type Envelope, type EnvelopeWindow } from '../envelope';
import type { CapabilityContext, CapabilityManifestEntry, Coverage } from '../types';
import { MAX_WINDOW_DAYS, resolveWindow, type ResolvedWindow } from '../window';

export type Args = Record<string, unknown>;
export type Entry = Pick<CapabilityManifestEntry, 'id' | 'title' | 'category'>;

/** The result of a read that may still be an empty or refused window. */
export type Read = Envelope<unknown>;

export const asWindow = (w: ResolvedWindow): EnvelopeWindow => w;
export const dayWindow = (w: ResolvedWindow, label = ''): DayWindow => ({ startKey: w.start, endKey: w.end, label });
export const inWindow = (w: ResolvedWindow, key: string): boolean => containsDay(dayWindow(w), key);
export const windowLength = (w: ResolvedWindow): number => diffDays(w.start, w.end) + 1;

/**
 * The window of a call. `window` wins; the legacy `days` argument is the same thing
 * as `window.lastDays`. Both together are ambiguous and refused.
 */
export function windowOf(args: Args, ctx: CapabilityContext, defaultLastDays: number): { ok: true; window: ResolvedWindow } | { ok: false; problems: string[] } {
  const hasDays = args.days !== undefined;
  if (hasDays && (typeof args.days !== 'number' || !Number.isInteger(args.days) || args.days < 1 || args.days > MAX_WINDOW_DAYS)) {
    return { ok: false, problems: [`days must be a whole number from 1 to ${MAX_WINDOW_DAYS}.`] };
  }
  if (hasDays && args.window !== undefined) return { ok: false, problems: ['Give either window or days (the same as window.lastDays), not both.'] };
  const input = hasDays ? { lastDays: args.days } : args.window;
  return resolveWindow(input, { refKey: ctx.refKey, defaultLastDays });
}

/** Privacy first, then the work; a thrown error is source_unavailable with its text scrubbed. */
export async function guarded(entry: Entry, ctx: CapabilityContext, work: () => Promise<Read>): Promise<Read> {
  if (!ctx.policy.allows(entry.category)) return privacyBlocked(entry);
  try {
    return await work();
  } catch (error) {
    return sourceUnavailable(entry, scrubForModel(error instanceof Error ? error.message : 'The read failed.'));
  }
}

export function problemsOf(entry: Entry, problems: string[], extra?: Record<string, unknown>): Read {
  return invalidArgs(entry, problems, extra);
}

/** `no_data_in_window`, with the data hints a retry needs added to the envelope. */
export function emptyWindow(entry: Entry, window: ResolvedWindow, coverage: Coverage, extra?: Record<string, unknown>): Read {
  const env = noDataInWindow(entry, asWindow(window), coverage);
  return extra ? { ...env, data: extra as never } : env;
}

/** First and last day of a set of day keys, and how many. */
export function spanOf(keys: string[], unit: string): Coverage {
  const sorted = [...keys].sort();
  return { kind: 'known', first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, count: sorted.length, unit };
}


export interface Paging {
  limit: number;
  offset: number;
}

/** `limit` and `offset` of a record tool, or the problems with them. */
export function pagingOf(args: Args, defaultLimit: number, maxLimit: number): { ok: true; paging: Paging } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const whole = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  if (args.limit !== undefined && (!whole(args.limit) || (args.limit as number) < 1 || (args.limit as number) > maxLimit)) problems.push(`limit must be a whole number from 1 to ${maxLimit}.`);
  if (args.offset !== undefined && (!whole(args.offset) || (args.offset as number) < 0)) problems.push('offset must be a whole number, 0 or more.');
  if (problems.length) return { ok: false, problems };
  return { ok: true, paging: { limit: (args.limit as number | undefined) ?? defaultLimit, offset: (args.offset as number | undefined) ?? 0 } };
}

/** A problem line when `value` is given and is not one of `allowed`. */
export function choiceProblem(name: string, value: unknown, allowed: readonly string[]): string[] {
  return value === undefined || (typeof value === 'string' && allowed.includes(value)) ? [] : [`${name} must be one of: ${allowed.join(', ')}.`];
}
