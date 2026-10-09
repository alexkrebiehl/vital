// ── The medication log of a window (SERVER ONLY) ────────────────────────────
//
// The dose records themselves, for the analyst's get_medications tool. The record
// source is read through the adapter (and its cache) for exactly the window asked,
// and days are cut in the profile's timezone, as on the Medications page.
//
// A failed read is stated, never turned into an empty log, and the reason is
// worded here without a host, a URL or a product name: the adapter's own messages
// are not passed on.

import { HaeError } from '../adapters/hae';
import { loadMedications, type MedicationRecord } from '../adapters/medications';
import { addDays } from '../analytics/windows';
import { readProfile } from '../profile/store';

/** Inclusive first and last day. */
export interface DayRange {
  start: string;
  end: string;
}

export interface MedicationLog {
  available: boolean;
  /** Why the log could not be read; null when it could. */
  reason: string | null;
  /** The zone each record's day was cut in. */
  timezone: string;
  records: MedicationRecord[];
}

export type MedicationLogReader = (range: DayRange) => Promise<MedicationLog>;

const NOT_CONFIGURED = 'The medication source is not configured, so no medication records can be read.';
const UNREADABLE = 'The medication records could not be read from the source.';

export const unavailableLog = (reason: string): MedicationLog => ({ available: false, reason, timezone: 'UTC', records: [] });

export async function loadMedicationLog(range: DayRange, deps: { env?: NodeJS.ProcessEnv } = {}): Promise<MedicationLog> {
  try {
    const timezone = (await readProfile(deps.env)).timezone;
    // The upstream end is a calendar boundary that excludes its own day.
    const result = await loadMedications({ from: range.start, to: addDays(range.end, 1) }, { ...(deps.env ? { env: deps.env } : {}), timezone });
    return { available: true, reason: null, timezone, records: result.records };
  } catch (error) {
    return unavailableLog(error instanceof HaeError && error.kind === 'not_configured' ? NOT_CONFIGURED : UNREADABLE);
  }
}
