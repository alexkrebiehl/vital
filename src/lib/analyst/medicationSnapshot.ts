// ── The analyst's medications context block (pure) ──────────────────────────
//
// The owner's medication records reach us through the Health Auto Export API,
// not from the metric dataset the retrieval bundle is built from, so they are
// read separately (see medicationsContext.ts) and flattened here.
//
// DETERMINISTIC, NO MODEL CALLS. Everything below is a pure function of the
// records the adapter returned, so the block states exactly what the Medications
// page and the Overview block state: the same grouping key, the same adherence
// words, the same window. Nothing is invented, and nothing the source does not
// state is derived — a dose/strength is never parsed out of a free-text label.
//
// WHAT THIS BLOCK IS. A record of what was logged. It is NOT a treatment plan,
// NOT advice, and NOT a complete list: Apple Health holds only what was entered,
// and the note says so. A record whose `scheduledDate` is null is attributable
// to no day; it is counted as undated and never dropped, and never guessed into
// a day.
//
// THE SAFETY RULES THAT GO WITH IT live in both places the analyst is
// instructed (DEFAULT_ANALYST_SYSTEM_PROMPT and config/analyst-prompt.md):
// never recommend starting, stopping, changing or skipping a medication; never
// treat a skipped dose as a clinical problem; never diagnose or attribute a
// symptom to a medication; never combine medication data with readings into a
// medical conclusion.

import type { MedicationRecord } from '@/lib/adapters/medications';
import type { MedicationContextSnapshot, MedicationSummary } from './types';

/** One medication, summarised the way the surfaces state it. */
export interface MedicationSourceInput {
  records: MedicationRecord[];
  /** The window the read covered, as echoed by the adapter. */
  from: string | null;
  to: string | null;
  /** ISO instant the read happened — the block's freshness. */
  readAt: string;
}

/** The window label the block states, in days, derived from the request. */
export interface BuildMedicationSnapshotOptions {
  /** The lookback the read was made with, in days. */
  lookbackDays: number;
  /** Today's calendar day (YYYY-MM-DD) in the app's reference timezone. */
  referenceDay: string;
}

function adherenceText(summary: MedicationSummary, lookbackDays: number): string {
  const recorded = `recorded on ${summary.daysRecorded} of the last ${lookbackDays} day${
    lookbackDays === 1 ? '' : 's'
  }`;
  const last = summary.lastDay ? `, last ${summary.lastDay}` : '';
  const skipped =
    summary.skipped > 0
      ? `; ${summary.skipped} recorded as skipped`
      : '; nothing recorded as skipped';
  return `${recorded}${last}${skipped}`;
}

/**
 * Build the bounded medications block for one analyst question.
 *
 * Every medication the read returned is carried (the set is small — one row per
 * medication, not per dose), plus the undated count so an undated record can
 * never be silently lost. The note states the window and the two facts the model
 * must not get wrong: the block is a record, and the list is not known to be
 * exhaustive.
 */
export function buildMedicationSnapshot(
  source: MedicationSourceInput,
  options: BuildMedicationSnapshotOptions
): MedicationContextSnapshot {
  const { lookbackDays, referenceDay } = options;

  // Group by the adapter's own key. The key is the leading name only; the full
  // label is kept per medication as the display value.
  const byKey = new Map<string, { display: string; records: MedicationRecord[] }>();
  for (const record of source.records) {
    const key = record.groupingKey;
    const entry = byKey.get(key) ?? { display: record.displayText, records: [] };
    entry.records.push(record);
    byKey.set(key, entry);
  }

  const medications: MedicationSummary[] = [];
  for (const [key, entry] of byKey) {
    const days = new Set<string>();
    let undated = 0;
    let skipped = 0;
    let taken = 0;
    let unknown = 0;
    let lastDay: string | null = null;
    for (const record of entry.records) {
      if (record.dayKey) {
        days.add(record.dayKey);
        if (lastDay === null || record.dayKey > lastDay) lastDay = record.dayKey;
      } else {
        undated += 1;
      }
      if (record.status === 'Skipped') skipped += 1;
      else if (record.status === 'Taken') taken += 1;
      else unknown += 1;
    }
    medications.push({
      groupingKey: key,
      displayText: entry.display,
      records: entry.records.length,
      daysRecorded: days.size,
      lastDay,
      taken,
      skipped,
      unknown,
      undated,
    });
  }

  // Stable order: most recently recorded first, then by volume, then by name.
  medications.sort((a, b) => {
    if (a.lastDay !== b.lastDay) {
      if (a.lastDay === null) return 1;
      if (b.lastDay === null) return -1;
      return a.lastDay < b.lastDay ? 1 : -1;
    }
    if (a.records !== b.records) return b.records - a.records;
    return a.groupingKey.localeCompare(b.groupingKey);
  });

  const totalRecords = source.records.length;
  const undatedTotal = medications.reduce((sum, m) => sum + m.undated, 0);
  const skippedTotal = medications.reduce((sum, m) => sum + m.skipped, 0);

  const undatedClause =
    undatedTotal > 0
      ? `; ${undatedTotal} record${undatedTotal === 1 ? '' : 's'} carry no scheduled date and belong to no day`
      : '';

  const note =
    medications.length === 0
      ? `no medication records were logged in the last ${lookbackDays} days`
      : `${medications.length} medication${
          medications.length === 1 ? '' : 's'
        } recorded in the last ${lookbackDays} days, ${totalRecords} dose record${
          totalRecords === 1 ? '' : 's'
        } in total${
          skippedTotal > 0 ? `, ${skippedTotal} recorded as skipped` : ''
        }${undatedClause}`;

  return {
    available: true,
    reason: null,
    referenceDay,
    lookbackDays,
    windowFrom: source.from,
    windowTo: source.to,
    readAt: source.readAt,
    totalRecords,
    totalMedications: medications.length,
    undatedRecords: undatedTotal,
    skippedRecords: skippedTotal,
    medications,
    /** The block's stated bound, in words. Never silent truncation. */
    note,
    /**
     * Why the list must not be read as complete: Apple Health holds only what
     * was entered by hand. Stated in the data so the model is given the
     * distinction rather than having to remember it.
     */
    completeness:
      'This list is what was entered in Apple Health. It is not known to be a complete list of medications.',
    /** The block states what it is, so the model can state it the same way. */
    kind: 'record',
  };
}

/** The unavailable block: a read that failed is stated, never hidden. */
export function unavailableMedicationSnapshot(reason: string): MedicationContextSnapshot {
  return {
    available: false,
    reason,
    referenceDay: null,
    lookbackDays: null,
    windowFrom: null,
    windowTo: null,
    readAt: null,
    totalRecords: 0,
    totalMedications: 0,
    undatedRecords: 0,
    skippedRecords: 0,
    medications: [],
    note: reason,
    completeness: null,
    kind: 'record',
  };
}

export { adherenceText };
