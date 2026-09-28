// ── The analyst's medications block ─────────────────────────────────────────
//
// The block exists so a question about medications is answerable from the
// recorded data rather than from the free-text profile note. These tests pin the
// two things that make it honest: it states what was logged (and never invents a
// dose), and a failed read is STATED rather than turned into "no medications".

import { describe, expect, it } from 'vitest';
import type { MedicationRecord } from '@/lib/adapters/medications';
import { buildMedicationSnapshot, unavailableMedicationSnapshot } from './medicationSnapshot';
import { loadMedicationSnapshot } from './medicationsContext';
import { DEFAULT_ANALYST_SYSTEM_PROMPT, buildContextPayload } from './systemPrompt';
import { retrieveGeneral } from './retrieval';

function record(over: Partial<MedicationRecord> & { dayKey: string | null }): MedicationRecord {
  return {
    ...over,
    id: over.id ?? 'id-' + Math.random().toString(36).slice(2),
    displayText: over.displayText ?? 'Carvedilol 6.25mg Oral tablet',
    groupingKey: over.groupingKey ?? 'Carvedilol',
    dosage: over.dosage ?? 1,
    status: over.status ?? 'Taken',
    scheduledDate: over.scheduledDate ?? (over.dayKey ? `${over.dayKey}T02:00:00.000Z` : null),
    start: null,
    end: null,
    isArchived: false,
    codings: [],
  };
}

const OPTIONS = { lookbackDays: 30, referenceDay: '2026-09-28' };

describe('the medications block summarises what was recorded', () => {
  it('groups by the adapter key and states adherence in words', () => {
    const built = buildMedicationSnapshot(
      {
        records: [
          record({ dayKey: '2026-09-27' }),
          record({ dayKey: '2026-09-28' }),
          record({ groupingKey: 'Retatrutide', displayText: 'Retatrutide', dayKey: '2026-09-22', status: 'Skipped' }),
        ],
        from: '2026-08-30',
        to: '2026-09-29',
        readAt: '2026-09-28T18:00:00.000Z',
      },
      OPTIONS
    );

    expect(built.available).toBe(true);
    expect(built.totalMedications).toBe(2);
    expect(built.totalRecords).toBe(3);
    expect(built.skippedRecords).toBe(1);

    const carvedilol = built.medications.find(m => m.groupingKey === 'Carvedilol')!;
    expect(carvedilol.daysRecorded).toBe(2);
    expect(carvedilol.lastDay).toBe('2026-09-28');
    expect(carvedilol.skipped).toBe(0);
    expect(carvedilol.displayText).toBe('Carvedilol 6.25mg Oral tablet');

    // Most recently recorded first.
    expect(built.medications[0].groupingKey).toBe('Carvedilol');
  });

  it('counts an undated record without dropping it or guessing a day', () => {
    const built = buildMedicationSnapshot(
      {
        records: [
          record({ dayKey: '2026-09-20' }),
          record({ dayKey: null, scheduledDate: null, groupingKey: 'Mots-C', displayText: 'Mots-C' }),
        ],
        from: '2026-08-30',
        to: '2026-09-29',
        readAt: '2026-09-28T18:00:00.000Z',
      },
      OPTIONS
    );

    expect(built.undatedRecords).toBe(1);
    const mots = built.medications.find(m => m.groupingKey === 'Mots-C')!;
    expect(mots.records).toBe(1);
    expect(mots.undated).toBe(1);
    expect(mots.daysRecorded).toBe(0);
    expect(mots.lastDay).toBeNull();
    expect(built.note).toMatch(/belong to no day/);
  });

  it('never invents a dose or strength: the label is carried verbatim', () => {
    const built = buildMedicationSnapshot(
      {
        records: [
          record({
            groupingKey: 'Losartan Potassium',
            displayText: 'Losartan Potassium 50mg, Hydrochlorothiazide 12.5mg Oral tablet',
            dayKey: '2026-09-28',
          }),
        ],
        from: null,
        to: null,
        readAt: '2026-09-28T18:00:00.000Z',
      },
      OPTIONS
    );
    // The summary restates the source's own text and derives no dose of its own.
    expect(built.medications[0].displayText).toBe(
      'Losartan Potassium 50mg, Hydrochlorothiazide 12.5mg Oral tablet'
    );
    expect(built.medications[0].groupingKey).toBe('Losartan Potassium');
  });

  it('states the completeness caveat and that the block is a record', () => {
    const built = buildMedicationSnapshot(
      { records: [record({ dayKey: '2026-09-28' })], from: null, to: null, readAt: '2026-09-28T18:00:00.000Z' },
      OPTIONS
    );
    expect(built.kind).toBe('record');
    expect(built.completeness).toMatch(/not known to be a complete list/i);
  });

  it('an empty window is an honest empty, not a failure', () => {
    const built = buildMedicationSnapshot(
      { records: [], from: '2026-08-30', to: '2026-09-29', readAt: '2026-09-28T18:00:00.000Z' },
      OPTIONS
    );
    expect(built.available).toBe(true);
    expect(built.totalMedications).toBe(0);
    expect(built.note).toMatch(/no medication records were logged/);
  });

  it('an unavailable block carries its reason rather than an empty record set', () => {
    const built = unavailableMedicationSnapshot('the API could not be reached');
    expect(built.available).toBe(false);
    expect(built.reason).toContain('could not be reached');
    expect(built.medications).toEqual([]);
  });
});

describe('the medications block reaches the model', () => {
  it('is serialized into the context payload the model was given', () => {
    const medications = buildMedicationSnapshot(
      { records: [record({ dayKey: '2026-09-28' })], from: '2026-08-30', to: '2026-09-29', readAt: '2026-09-28T18:00:00.000Z' },
      OPTIONS
    );
    const bundle = { ...retrieveGeneral('2026-09-28'), medications };
    const payload = buildContextPayload(bundle, 'imperial') as Record<string, unknown>;
    expect(payload.medications).toBeDefined();
    const meds = payload.medications as Record<string, unknown>;
    expect(meds.available).toBe(true);
    expect(meds.kind).toBe('record');
    expect(meds.completeness).toMatch(/complete list/i);
  });

  it('carries null when there is no block, so the model is not handed a false empty', () => {
    const payload = buildContextPayload(retrieveGeneral('2026-09-28'), 'imperial') as Record<string, unknown>;
    expect(payload.medications).toBeNull();
  });

  it('the safety rules are present in the analyst instructions', () => {
    // Pinned so the contract cannot be silently dropped later.
    for (const needed of [
      /never recommend starting, stopping, changing, skipping or resuming any medication/i,
      /never treat a missed or skipped dose as a clinical problem/i,
      /never diagnose, or state or imply that a medication caused/i,
      /never combine medication records with readings to reach a medical conclusion/i,
      /NOT known to be complete/i,
    ]) {
      expect(DEFAULT_ANALYST_SYSTEM_PROMPT).toMatch(needed);
    }
  });
});

describe('loadMedicationSnapshot states a failure instead of hiding it', () => {
  it('reports unconfigured rather than answering from an empty set', async () => {
    // No HAE credentials in the injected env: the read cannot be made.
    const built = await loadMedicationSnapshot('how am I doing on my medications?', {
      env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
    });
    expect(built.available).toBe(false);
    expect(built.reason).toBeTruthy();
    expect(built.medications).toEqual([]);
  });
});
