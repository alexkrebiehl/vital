// ── Medication doses and their summary (SERVER ONLY) ──────────────────────────
//
// What was LOGGED, never what was planned: a record of doses, not a treatment plan
// and not known to be complete. Nothing here advises or judges a dose. The summary
// is the same block the question's context carries (`MedicationContextSnapshot`),
// built by the same function, for the window asked.

import { clockLabel } from '../../../analytics/windows';
import type { MedicationRecord } from '../../../adapters/medications';
import { buildMedicationSnapshot } from '../../medicationSnapshot';
import type { MedicationContextSnapshot, MedicationSummary } from '../../types';
import { manifestEntry } from '../manifest';
import { ok, pageRows } from '../envelope';
import type { CapabilityContext } from '../types';
import { asWindow, guarded, pagingOf, problemsOf, windowLength, type Args, type Read } from './common';
import { plural, selectMedications, undatedNote, type MedicationSelection } from './medications-select';

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 100;
const MAX_CHARS = 9_500;

const COMPLETENESS = 'This list is what was entered in the health app. It is not known to be a complete list of medications.';

export interface DoseRow {
  day: string;
  time: string;
  /** The medication's name: the leading text of the label, the grouping key. */
  medication: string;
  status: 'taken' | 'skipped' | 'unknown';
  /** The label exactly as logged (its strength is never parsed out), when it says more than the name. */
  dose?: string;
}

export function doseRow(r: MedicationRecord, timezone: string): DoseRow {
  const row: DoseRow = {
    day: r.dayKey as string,
    time: clockLabel(r.scheduledDate as string, timezone),
    medication: r.groupingKey,
    status: r.status === 'Taken' ? 'taken' : r.status === 'Skipped' ? 'skipped' : 'unknown',
  };
  return r.displayText.trim() !== r.groupingKey ? { ...row, dose: r.displayText } : row;
}

export function readMedicationDoses(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('medications.doses');
  return guarded(entry, ctx, async () => {
    const paged = pagingOf(args, DEFAULT_LIMIT, MAX_LIMIT);
    if (!paged.ok) return problemsOf(entry, paged.problems);
    const picked = await selectMedications(args, ctx, 'medications.doses');
    if (!picked.ok) return picked.env;
    const { sel } = picked;

    const { rows, page } = pageRows(sel.dated, { limit: paged.paging.limit, offset: paged.paging.offset, maxChars: MAX_CHARS, render: r => doseRow(r, sel.timezone) });
    remember(ctx, sel);
    const data = {
      kind: 'record',
      completeness: COMPLETENESS,
      doses: rows,
      ...(sel.undated.length ? { undatedRecords: sel.undated.length, display: undatedNote(sel.undated.length) } : {}),
    };
    return ok(entry, data, { window: asWindow(sel.window), page });
  });
}

/** One medication as the summary states it, with the line the model quotes. */
function medicationRow(m: MedicationSummary) {
  const last = m.lastDay ? `, last ${m.lastDay}` : '';
  const undated = m.undated ? `; ${plural(m.undated, 'record')} on no day` : '';
  const line = `${m.groupingKey}: ${plural(m.records, 'dose record')} on ${plural(m.daysRecorded, 'day')}${last}; ${m.taken} taken, ${m.skipped} skipped, ${m.unknown} unknown${undated}`;
  return {
    medication: m.groupingKey,
    label: m.displayText,
    records: m.records,
    daysRecorded: m.daysRecorded,
    lastDay: m.lastDay,
    taken: m.taken,
    skipped: m.skipped,
    unknown: m.unknown,
    undated: m.undated,
    display: line,
  };
}

/** The block for the window, worded for that window (the builder's own note says "the last N days"). */
function snapshotOf(sel: MedicationSelection, ctx: CapabilityContext): MedicationContextSnapshot {
  const days = windowLength(sel.window);
  const built = buildMedicationSnapshot(
    { records: [...sel.dated, ...sel.undated], from: sel.window.start, to: sel.window.end, readAt: '' },
    { lookbackDays: days, referenceDay: ctx.refKey }
  );
  const skipped = built.skippedRecords ? `, ${built.skippedRecords} recorded as skipped` : '';
  const note = built.totalMedications === 0
    ? `no medication records were logged between ${sel.window.start} and ${sel.window.end}`
    : `${plural(built.totalMedications, 'medication')} recorded between ${sel.window.start} and ${sel.window.end}, ${plural(built.totalRecords, 'dose record')} in total${skipped}`;
  return { ...built, readAt: null, note, completeness: COMPLETENESS };
}

/** What was fetched is what the answer may cite and the number audit checks. */
function remember(ctx: CapabilityContext, sel: MedicationSelection): MedicationContextSnapshot {
  const snap = snapshotOf(sel, ctx);
  ctx.access.fetched.medications = snap;
  ctx.access.fetched.recordsRead += snap.totalRecords;
  ctx.access.fetched.log.push(`medication log ${sel.window.start}..${sel.window.end}`);
  return snap;
}

export function readMedicationSummary(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('medications.summary');
  return guarded(entry, ctx, async () => {
    const picked = await selectMedications(args, ctx, 'medications.summary');
    if (!picked.ok) return picked.env;
    const snap = remember(ctx, picked.sel);
    const data = {
      kind: snap.kind,
      note: snap.note,
      completeness: snap.completeness,
      lookbackDays: snap.lookbackDays,
      totalMedications: snap.totalMedications,
      totalRecords: snap.totalRecords,
      skippedRecords: snap.skippedRecords,
      undatedRecords: snap.undatedRecords,
      medications: snap.medications.map(medicationRow),
      display: { totals: `${plural(snap.totalMedications, 'medication')}, ${plural(snap.totalRecords, 'dose record')}, ${snap.skippedRecords} skipped, ${snap.undatedRecords} on no day` },
    };
    return ok(entry, data, { window: asWindow(picked.sel.window) });
  });
}
