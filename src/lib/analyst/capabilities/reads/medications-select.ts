// ── Which medication records a call asks for (SERVER ONLY) ───────────────────
//
// The window, the name filter and the read, shared by the dose rows and the
// summary. Records that carry no scheduled date belong to no day: they are never
// placed in a window, and they are counted so they are neither dropped nor guessed.

import type { MedicationRecord } from '../../../adapters/medications';
import { manifestEntry } from '../manifest';
import { sourceUnavailable } from '../envelope';
import type { CapabilityContext, Coverage } from '../types';
import type { ResolvedWindow } from '../window';
import { emptyWindow, inWindow, problemsOf, windowOf, type Args, type Read } from './common';

export const DEFAULT_DAYS = 30;
export const MAX_NAME = 80;

/** What the app can say about how far back the log goes: only the log itself. */
export const MEDICATIONS_COVERAGE: Coverage = {
  kind: 'unknown',
  reason: 'only the medication log itself can say how far back it goes; the window asked was read from it',
};

export interface MedicationSelection {
  window: ResolvedWindow;
  timezone: string;
  /** Dated records inside the window, newest first. */
  dated: MedicationRecord[];
  /** Records that belong to no day, after the name filter. */
  undated: MedicationRecord[];
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export const undatedNote = (n: number): string => `${plural(n, 'record')} carry no scheduled date and belong to no day, so none is placed in this window.`;

const stamp = (r: MedicationRecord): string => r.scheduledDate ?? '';

/** The newest record first: by day, then by time within the day. */
const newestFirst = (a: MedicationRecord, b: MedicationRecord): number => stamp(b).localeCompare(stamp(a)) || a.id.localeCompare(b.id);

export function nameProblem(args: Args): string[] {
  if (args.name === undefined) return [];
  if (typeof args.name !== 'string' || args.name.trim() === '' || args.name.length > MAX_NAME) return [`name must be text of 1 to ${MAX_NAME} characters.`];
  return [];
}

/** Loads the log for the window of the call, or the envelope to answer with instead. */
export async function selectMedications(
  args: Args,
  ctx: CapabilityContext,
  id: 'medications.doses' | 'medications.summary'
): Promise<{ ok: true; sel: MedicationSelection } | { ok: false; env: Read }> {
  const entry = manifestEntry(id);
  const w = windowOf(args, ctx, DEFAULT_DAYS);
  const problems = [...(w.ok ? [] : w.problems), ...nameProblem(args)];
  if (!w.ok || problems.length) return { ok: false, env: problemsOf(entry, problems) };

  const log = await ctx.access.medicationLog({ start: w.window.start, end: w.window.end });
  if (!log.available) return { ok: false, env: sourceUnavailable(entry, log.reason ?? 'The medication records could not be read.') };

  const needle = typeof args.name === 'string' ? args.name.trim().toLowerCase() : null;
  const named = log.records.filter(r => !needle || r.displayText.toLowerCase().includes(needle) || r.groupingKey.toLowerCase().includes(needle));
  const dated = named.filter(r => r.dayKey !== null && inWindow(w.window, r.dayKey)).sort(newestFirst);
  const undated = named.filter(r => r.dayKey === null);
  // A record on no day is never in a window, so a window with only those is an empty one.
  if (dated.length === 0) {
    const hint = undated.length ? { undatedRecords: undated.length, display: undatedNote(undated.length) } : undefined;
    return { ok: false, env: emptyWindow(entry, w.window, MEDICATIONS_COVERAGE, hint) };
  }
  return { ok: true, sel: { window: w.window, timezone: log.timezone, dated, undated } };
}
