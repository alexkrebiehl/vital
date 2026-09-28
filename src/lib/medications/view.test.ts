// ── Tests for the Medications page view model ───────────────────────────────
//
// Pure functions only, so every honesty rule the Medications surface claims is
// pinned here rather than through the DOM: today's doses from the window's
// records, the per-medication grouping and ordering, the per-day series that
// excludes a day with no records, the null-`dayKey` record that must not crash
// or be dropped, the dosage that is said in words when absent, and the empty
// state.

import { describe, it, expect } from 'vitest';
import type { MedicationRecord } from '@/lib/adapters/medications';
import {
  MEDICATION_DAY_TZ,
  MEDICATIONS_LOOKBACK_DAYS,
  countStatuses,
  coverageDays,
  coverageLabel,
  dailyStatusSeries,
  formatUnits,
  groupMedications,
  hasNoRecords,
  medicationsWindow,
  recordedDays,
  recordsOnDay,
  scheduledTimeLabel,
  statusSummaryWords,
  undatedRecords,
} from './view';

// ── Builders ────────────────────────────────────────────────────────────────

function makeRecord(input: {
  id?: string;
  displayText?: string;
  groupingKey?: string;
  dosage?: number | null;
  status?: MedicationRecord['status'];
  scheduledDate?: string | null;
  dayKey?: string | null;
}): MedicationRecord {
  // Note the explicit null checks: an explicit `scheduledDate: null` or
  // `dayKey: null` must survive, so `??` on its own would silently replace it
  // with the default — which is exactly the undated-record case under test.
  const scheduledDate = 'scheduledDate' in input ? input.scheduledDate ?? null : '2026-09-28T03:00:00.000Z';
  const dayKeyValue = 'dayKey' in input ? input.dayKey ?? null : '2026-09-28';
  return {
    id: input.id ?? 'x',
    displayText: input.displayText ?? 'Carvedilol 6.25mg Oral tablet',
    groupingKey: input.groupingKey ?? 'Carvedilol',
    dosage: input.dosage ?? 1,
    status: input.status ?? 'Taken',
    scheduledDate,
    dayKey: dayKeyValue,
    start: null,
    end: null,
    isArchived: false,
    codings: [],
  };
}

/** The window the surface reads, shaped like the verified live payload. */
const RECORDS: MedicationRecord[] = [
  makeRecord({ id: 'a1', scheduledDate: '2026-09-28T03:00:00.000Z', dayKey: '2026-09-28' }),
  makeRecord({
    id: 'a2',
    scheduledDate: '2026-09-28T15:00:00.000Z',
    dayKey: '2026-09-28',
    status: 'Skipped',
  }),
  makeRecord({
    id: 'b1',
    displayText: 'Atorvastatin 20mg Oral tablet',
    groupingKey: 'Atorvastatin',
    scheduledDate: '2026-09-27T15:00:00.000Z',
    dayKey: '2026-09-27',
  }),
  makeRecord({
    id: 'c1',
    displayText: 'Mots-C',
    groupingKey: 'Mots-C',
    scheduledDate: null,
    dayKey: null,
  }),
];

// ── Window ──────────────────────────────────────────────────────────────────

describe('medicationsWindow (§ from inclusive, to a calendar boundary past the last day)', () => {
  it('spans the lookback and sets `to` one day past the last day to show', () => {
    const win = medicationsWindow('2026-09-28', 30);
    expect(win.from).toBe('2026-08-30');
    // Records dated `to` itself are excluded upstream, so `to` is the 29th.
    expect(win.to).toBe('2026-09-29');
  });

  it('defaults to the shared lookback', () => {
    expect(medicationsWindow('2026-09-28')).toEqual(medicationsWindow('2026-09-28', MEDICATIONS_LOOKBACK_DAYS));
  });
});

// ── Today's doses ───────────────────────────────────────────────────────────

describe('recordsOnDay (§ today’s doses)', () => {
  it('returns only the records attributable to the day, by scheduled time', () => {
    const today = recordsOnDay(RECORDS, '2026-09-28');
    expect(today.map(r => r.id)).toEqual(['a1', 'a2']);
    expect(today[0].status).toBe('Taken');
    expect(today[1].status).toBe('Skipped');
  });

  it('never counts an undated record into a day', () => {
    expect(recordsOnDay(RECORDS, '2026-09-28').some(r => r.id === 'c1')).toBe(false);
  });

  it('returns nothing for a day with no records', () => {
    expect(recordsOnDay(RECORDS, '2026-09-25')).toEqual([]);
  });
});

// ── The null-dayKey record ──────────────────────────────────────────────────

describe('undatedRecords (§ a null dayKey is listed, never dropped)', () => {
  it('collects the record with no scheduled date without crashing a day read', () => {
    const undated = undatedRecords(RECORDS);
    expect(undated.map(r => r.id)).toEqual(['c1']);
  });
});

// ── Grouping ────────────────────────────────────────────────────────────────

describe('groupMedications (§ per-medication history)', () => {
  it('groups by the adapter key and reports days, last day and skipped count', () => {
    const groups = groupMedications(RECORDS);
    const carvedilol = groups.find(g => g.key === 'Carvedilol')!;
    expect(carvedilol.days).toEqual(['2026-09-28']);
    expect(carvedilol.lastDay).toBe('2026-09-28');
    expect(carvedilol.skipped).toBe(1);
    expect(carvedilol.records).toHaveLength(2);

    const atorvastatin = groups.find(g => g.key === 'Atorvastatin')!;
    expect(atorvastatin.days).toEqual(['2026-09-27']);
    expect(atorvastatin.skipped).toBe(0);
  });

  it('orders by the newest recorded day, then by name', () => {
    expect(groupMedications(RECORDS).map(g => g.key)).toEqual(['Carvedilol', 'Atorvastatin', 'Mots-C']);
  });

  it('sorts a group with only undated records last and reports lastDay null', () => {
    const groups = groupMedications(RECORDS);
    const last = groups[groups.length - 1];
    expect(last.key).toBe('Mots-C');
    expect(last.lastDay).toBeNull();
    expect(last.days).toEqual([]);
  });

  it('never mutates the input', () => {
    const snapshot = RECORDS.map(r => r.id);
    groupMedications(RECORDS);
    expect(RECORDS.map(r => r.id)).toEqual(snapshot);
  });
});

// ── Per-day series ──────────────────────────────────────────────────────────

describe('dailyStatusSeries (§ a day with no records is not a zero bar)', () => {
  it('emits one row per recorded day, oldest first, with counts by status', () => {
    expect(dailyStatusSeries(RECORDS)).toEqual([
      { day: '2026-09-27', taken: 1, skipped: 0, unknown: 0 },
      { day: '2026-09-28', taken: 1, skipped: 1, unknown: 0 },
    ]);
  });

  it('excludes days with no records entirely rather than plotting zeros', () => {
    const days = dailyStatusSeries(RECORDS).map(r => r.day);
    expect(days).toEqual(['2026-09-27', '2026-09-28']);
    expect(days).not.toContain('2026-09-26');
  });

  it('is empty for an empty window', () => {
    expect(dailyStatusSeries([])).toEqual([]);
  });
});

// ── Counts and words ────────────────────────────────────────────────────────

describe('counts and summary words (§ never invent a status)', () => {
  it('counts each status separately', () => {
    expect(countStatuses(RECORDS)).toEqual({ taken: 3, skipped: 1, unknown: 0 });
  });

  it('names only the statuses that have a record behind them', () => {
    expect(statusSummaryWords(RECORDS)).toEqual(['3 Taken', '1 Skipped']);
  });

  it('says an unrecorded status in words rather than counting it as taken', () => {
    const records = [makeRecord({ id: 'u', status: 'Unknown' })];
    expect(statusSummaryWords(records)).toEqual(['1 with no status recorded']);
  });
});

// ── Dosage and time labels ──────────────────────────────────────────────────

describe('formatUnits (§ never render 0 for a missing dose)', () => {
  it('pluralises a dose of units', () => {
    expect(formatUnits(1)).toBe('1 unit');
    expect(formatUnits(2)).toBe('2 units');
  });

  it('says a missing dosage in words, never 0', () => {
    expect(formatUnits(null)).toBe('no dosage recorded');
    expect(formatUnits(undefined)).toBe('no dosage recorded');
    expect(formatUnits(Number.NaN)).toBe('no dosage recorded');
  });
});

describe('scheduledTimeLabel (§ deterministic, in the attribution timezone)', () => {
  it('renders the scheduled time of day', () => {
    expect(scheduledTimeLabel('2026-09-28T03:00:00.000Z')).toBe('3:00 AM');
    expect(scheduledTimeLabel('2026-09-28T15:30:00.000Z')).toBe('3:30 PM');
  });

  it('says so when there is no scheduled date or it is unparseable', () => {
    expect(scheduledTimeLabel(null)).toBe('no scheduled time');
    expect(scheduledTimeLabel('not-a-date')).toBe('no scheduled time');
  });

  it('attributes in UTC, mirroring the adapter day key', () => {
    expect(MEDICATION_DAY_TZ).toBe('UTC');
  });
});

// ── Coverage ────────────────────────────────────────────────────────────────

describe('coverage (§ the window actually covered)', () => {
  it('labels the covered span with both years', () => {
    expect(
      coverageLabel({ from: '2026-08-25T12:00:00.000Z', to: '2026-09-28T03:00:00.000Z' })
    ).toBe('Aug 25, 2026 – Sep 28, 2026');
  });

  it('derives the covered day keys from the instants', () => {
    expect(coverageDays({ from: '2026-08-25T12:00:00.000Z', to: '2026-09-28T03:00:00.000Z' })).toEqual({
      from: '2026-08-25',
      to: '2026-09-28',
    });
  });

  it('states nothing when no record was attributable', () => {
    expect(coverageDays(null)).toBeNull();
    expect(coverageLabel(null)).toBeNull();
  });
});

describe('recordedDays (§ the days any record falls on)', () => {
  it('lists the distinct attributable days, sorted, excluding undated records', () => {
    expect(recordedDays(RECORDS)).toEqual(['2026-09-27', '2026-09-28']);
  });
});

// ── Empty state ─────────────────────────────────────────────────────────────

describe('hasNoRecords (§ the honest empty state)', () => {
  it('is true for a genuinely empty window', () => {
    expect(hasNoRecords([])).toBe(true);
  });

  it('is false as soon as one record — even an undated one — is present', () => {
    expect(hasNoRecords([makeRecord({ scheduledDate: null, dayKey: null })])).toBe(false);
  });
});
