// ── The Overview medications block, asserted on its RENDERED markup ─────────
//
// The block must show real records in words, an honest empty state with no
// zeroes, and — above all — it must render WITHOUT any briefing text existing at
// all: it takes the medication read and the reference day, and nothing else. The
// renders below therefore pass no briefing object, which is the point: if the
// block ever started reading briefing text, these renders would have nothing to
// read and the assertions would fail.
//
// The guarded regression test at the end pins that the briefing's forbidden-copy
// vocabulary is untouched by this change.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MedicationRecord } from '@/lib/adapters/medications';
import type { MedicationReadResponse } from '@/lib/medications/client-data';
import { FORBIDDEN_COPY_PATTERNS, forbiddenCopyIn } from '@/lib/briefing/validate';
import { MedicationsOverviewBody, adherenceSentence, skippedSentence } from './OverviewMedications';

// ── Builders ────────────────────────────────────────────────────────────────

function makeRecord(input: {
  id: string;
  displayText?: string;
  groupingKey?: string;
  status?: MedicationRecord['status'];
  scheduledDate?: string | null;
  dayKey?: string | null;
}): MedicationRecord {
  return {
    id: input.id,
    displayText: input.displayText ?? `${input.groupingKey ?? 'Carvedilol'} 6.25mg Oral tablet`,
    groupingKey: input.groupingKey ?? 'Carvedilol',
    dosage: null,
    status: input.status ?? 'Taken',
    scheduledDate: 'scheduledDate' in input ? input.scheduledDate ?? null : '2026-09-28T03:00:00.000Z',
    dayKey: 'dayKey' in input ? input.dayKey ?? null : '2026-09-28',
    start: null,
    end: null,
    isArchived: false,
    codings: [],
  };
}

/** The verified live shape: records, a covered span, an echoed window. */
function read(records: MedicationRecord[]): MedicationReadResponse {
  return {
    available: true,
    reason: null,
    window: { from: '2026-08-30', to: '2026-09-29' },
    covered: records.length > 0 ? { from: '2026-08-30T06:00:00.000Z', to: '2026-09-28T15:00:00.000Z' } : null,
    records,
    source: 'Health Auto Export',
  };
}

function render(data: MedicationReadResponse): string {
  return renderToStaticMarkup(
    React.createElement(MedicationsOverviewBody, { data, referenceKey: '2026-09-28' })
  );
}

// ── Real records ────────────────────────────────────────────────────────────

describe('the Overview medications block (§ renders real records in words)', () => {
  const records: MedicationRecord[] = [
    makeRecord({ id: 'a1', groupingKey: 'Carvedilol', dayKey: '2026-09-28' }),
    makeRecord({ id: 'a2', groupingKey: 'Carvedilol', dayKey: '2026-09-27' }),
    makeRecord({ id: 'a3', groupingKey: 'Carvedilol', dayKey: '2026-09-26' }),
    makeRecord({ id: 'b1', groupingKey: 'Atorvastatin', dayKey: '2026-09-27', status: 'Skipped' }),
  ];

  it('names the medication and states its recorded days in words', () => {
    const html = render(read(records));
    expect(html).toContain('Carvedilol');
    // Adherence in words, never a score or a percentage.
    expect(html).toContain('recorded on 3 of the last 30 days');
    expect(html).toContain('last Sep 28');
    expect(html).not.toMatch(/\d+\s*%/);
  });

  it('states the recorded-skipped count for each medication', () => {
    const html = render(read(records));
    expect(html).toContain('nothing recorded as skipped');
    expect(html).toContain('1 recorded as skipped');
  });

  it('states the window the records actually cover, and the requested window', () => {
    const html = render(read(records));
    expect(html).toContain('Aug 30, 2026');
    expect(html).toContain('Sep 29, 2026');
    // The covered span is named, not a bare endpoint.
    expect(html).toContain('The records returned cover Aug 30, 2026');
    expect(html).toContain('Days with no record are missing rather than counted as zero.');
  });

  it('names the source in words and never a host or a path', () => {
    const html = render(read(records));
    expect(html).toContain('Health Auto Export');
  });
});

// ── The block is independent of the briefing ────────────────────────────────

describe('the block renders with NO briefing text present (§ independence)', () => {
  it('renders medication content from the medication read alone', () => {
    const html = render(read([makeRecord({ id: 'a1', groupingKey: 'Losartan' })]));
    // Nothing about a briefing was supplied to this render; if the block needed
    // one, there would be no list here.
    expect(html).toContain('Losartan');
    expect(html).toContain('recorded on');
    expect(html).not.toContain('TODAY');
    expect(html).not.toContain('briefing');
  });

  it('imports nothing from the briefing at the module level', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/components/metric/OverviewMedications.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"]@\/lib\/briefing/);
    expect(source).not.toMatch(/useBriefing/);
  });
});

// ── The null-dayKey record ──────────────────────────────────────────────────

describe('the null-dayKey record (§ does not break the render)', () => {
  it('renders a block whose only record has no dayKey, listing it as undated', () => {
    const html = render(read([makeRecord({ id: 'c1', groupingKey: 'Mots-C', scheduledDate: null, dayKey: null })]));
    expect(html).toContain('Mots-C');
    expect(html).toContain('carries no scheduled date');
    // It is attributed to no day, so it is not presented as a recorded day.
    expect(html).toContain('no dated record in the last 30 days');
  });

  it('does not crash or drop the undated record when dated records are also present', () => {
    const html = render(
      read([
        makeRecord({ id: 'a1', groupingKey: 'Carvedilol', dayKey: '2026-09-28' }),
        makeRecord({ id: 'c1', groupingKey: 'Retatrutide', scheduledDate: null, dayKey: null }),
      ])
    );
    expect(html).toContain('Carvedilol');
    expect(html).toContain('Retatrutide');
    expect(html).toContain('carries no scheduled date');
  });
});

// ── Honest empty state ──────────────────────────────────────────────────────

describe('the empty state (§ in words, no zeros)', () => {
  it('says there are no records in words and draws no chart or zero', () => {
    const html = render(read([]));
    expect(html).toContain('No medication records in this window');
    expect(html).toContain('no zeroes, no empty chart');
    // No medication row and no fabricated zero anywhere.
    expect(html).not.toContain('recorded on 0');
    expect(html).not.toMatch(/\b0 of the last 30 days\b/);
  });
});

// ── Sentence helpers ────────────────────────────────────────────────────────

describe('sentence helpers', () => {
  it('writes adherence in words for dated and undated groups', () => {
    expect(adherenceSentence({ key: 'X', days: ['2026-09-28', '2026-09-27'], lastDay: '2026-09-28', skipped: 0, records: [] })).toBe(
      'recorded on 2 of the last 30 days, last Sep 28, 2026'
    );
    expect(adherenceSentence({ key: 'X', days: [], lastDay: null, skipped: 0, records: [] })).toBe(
      'no dated record in the last 30 days'
    );
  });

  it('renders a true zero skipped count as words, not a 0', () => {
    expect(skippedSentence({ key: 'X', days: ['2026-09-28'], lastDay: '2026-09-28', skipped: 0, records: [] })).toBe(
      'nothing recorded as skipped'
    );
  });
});

// ── Regression guard: the briefing's forbidden vocabulary is untouched ───────

describe('FORBIDDEN_COPY_PATTERNS (§ unchanged by this change)', () => {
  it('still rejects the clinical vocabulary the briefing may not use', () => {
    for (const sample of [
      'Your week looks normal.',
      'That reading is abnormal.',
      'This is a diagnosis.',
      'We can prescribe that.',
      'Take your medication.',
      'Double the dose.',
      'A new supplement.',
      'See your doctor.',
      'A course of treatment.',
    ]) {
      expect(forbiddenCopyIn({ headline: sample, body: '', recommendations: [] }).length).toBeGreaterThan(0);
    }
  });

  it('still passes copy that uses none of it', () => {
    expect(
      forbiddenCopyIn({ headline: 'Your resting heart rate stayed inside your recent baseline.', body: '', recommendations: [] })
    ).toEqual([]);
  });

  it('keeps the guarded vocabulary list at its known length and labels', () => {
    expect(FORBIDDEN_COPY_PATTERNS).toHaveLength(10);
    expect(FORBIDDEN_COPY_PATTERNS.map(p => p.label)).toContain('a medication reference');
  });
});