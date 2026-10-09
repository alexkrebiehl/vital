// ── The coverage index (design §5.2) ─────────────────────────

import { describe, expect, it } from 'vitest';
import type { LabIndex, MetricIndexEntry } from '../dataIndex';
import { collectCoverageRows, COVERAGE_INDEX_MAX_CHARS, renderCoverageIndex, type CoverageRow } from './coverage-index';
import { CAPABILITIES } from './registry';
import { testCtx } from './test-context.fake';
import type { Coverage, PrivacyPolicy } from './types';

const NO_LABS: LabIndex = { available: true, reason: null, documents: 0, observations: 0, panelDates: [], categories: [] };

const rows = (coverage: (id: string) => CoverageRow['coverage']): CoverageRow[] => CAPABILITIES.map(c => ({ id: c.id, title: c.title, coverage: coverage(c.id) }));
const known = (count: number, unit = 'days'): Coverage => ({ kind: 'known', first: '2026-01-02', last: '2026-10-08', count, unit });

function metrics(n: number): MetricIndexEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `metric_number_${String(i).padStart(2, '0')}`,
    name: `Metric number ${i} with a realistically long display name`,
    category: `Category ${i % 8}`,
    from: '2025-01-02',
    to: '2026-10-08',
    days: '400/644',
    frequency: 'daily',
  }));
}

function labs(series: number): LabIndex {
  const cats = Array.from({ length: 12 }, (_, c) => ({
    category: `Lab category ${c}`,
    series: Array.from({ length: Math.ceil(series / 12) }, (_, i) => ({ key: `s${c}_${i}`, name: `Analyte ${c}-${i}`, observations: 2, latest: '2026-10-01' })),
  }));
  const dates = Array.from({ length: 40 }, (_, i) => ({ on: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, series: 5 }));
  return { available: true, reason: null, documents: 9, observations: series * 2, panelDates: dates, categories: cats };
}

describe('renderCoverageIndex', () => {
  it('opens with today and says absence is a tool result', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(412)), metrics: [], labs: NO_LABS });
    expect(text).toContain('2026-10-08');
    expect(text).toMatch(/tool result|no_data_in_window/);
  });

  it('gives each capability its first..last, count and unit', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(id => (id === 'workouts.sessions' ? known(412, 'workouts') : known(3))), metrics: [], labs: NO_LABS });
    expect(text).toContain('workouts.sessions · 2026-01-02..2026-10-08 · 412 workouts');
  });

  it('says unknown, never zero, for a capability only the upstream can count', () => {
    const text = renderCoverageIndex({
      refKey: '2026-10-08',
      rows: rows(id => (id === 'medications.doses' ? { kind: 'unknown', reason: 'the upstream is asked when read' } : known(3))),
      metrics: [],
      labs: NO_LABS,
    });
    expect(text).toContain('medications.doses · unknown — fetch to see');
    expect(text).not.toMatch(/medications\.doses · .*\b0\b/);
  });

  it('gives the reason when a capability is unavailable, scrubbed', () => {
    const text = renderCoverageIndex({
      refKey: '2026-10-08',
      rows: rows(id => (id === 'labs.series' ? { kind: 'unavailable', reason: 'No database is configured. host db.internal.example.com' } : known(3))),
      metrics: [],
      labs: NO_LABS,
    });
    expect(text).toContain('labs.series · unavailable — No database is configured.');
    expect(text).not.toContain('internal.example.com');
  });

  it('says a held-nothing capability holds none, plainly', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => ({ kind: 'known', first: null, last: null, count: 0, unit: 'workouts' })), metrics: [], labs: NO_LABS });
    expect(text).toContain('workouts.sessions · the app holds none');
  });

  it('marks a withheld capability with no count', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(id => (id === 'heart.blood_pressure' ? { kind: 'withheld' } : known(88, 'readings'))), metrics: [], labs: NO_LABS });
    expect(text).toContain('heart.blood_pressure · withheld by the AI privacy setting');
    const line = text.split('\n').find(l => l.startsWith('heart.blood_pressure'))!;
    expect(line).not.toMatch(/\d/);
  });

  it('lists every metric with data, dates and days recorded', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(3)), metrics: metrics(3), labs: NO_LABS });
    expect(text).toContain('metric_number_01 | Metric number 1 with a realistically long display name | 2025-01-02..2026-10-08 | 400/644 | daily');
  });

  it('lists lab panel dates and series by category', () => {
    const l: LabIndex = {
      available: true,
      reason: null,
      documents: 2,
      observations: 7,
      panelDates: [{ on: '2026-09-29', series: 4 }, { on: '2026-10-01', series: 3 }],
      categories: [{ category: 'Lipids', series: [{ key: 'ldl', name: 'LDL cholesterol', observations: 2, latest: '2026-10-01' }] }],
    };
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(3)), metrics: [], labs: l });
    expect(text).toContain('Panel dates (date: series measured): 2026-09-29: 4, 2026-10-01: 3');
    expect(text).toContain('Lipids: LDL cholesterol (2×)');
  });

  it('states why labs are missing instead of listing nothing', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(3)), metrics: [], labs: { ...NO_LABS, available: false, reason: 'No Postgres database is configured.' } });
    expect(text).toContain('LAB RESULTS — not available: No Postgres database is configured.');
  });

  it('carries no measured value', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(3)), metrics: metrics(3), labs: NO_LABS });
    expect(text).not.toMatch(/mmHg|bpm|kg\b/);
  });

  it('withholds the metric and lab lines when the privacy setting does', () => {
    const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(3)), metrics: metrics(3), labs: labs(24), withheld: { metrics: true, labs: true } });
    expect(text).not.toContain('metric_number_01');
    expect(text).not.toContain('Analyte 0-0');
    expect(text).toMatch(/METRICS — withheld by the AI privacy setting/);
    expect(text).toMatch(/LAB RESULTS — withheld by the AI privacy setting/);
  });

  describe('the size bound', () => {
    it('is 6,000 characters', () => expect(COVERAGE_INDEX_MAX_CHARS).toBe(6_000));

    it('holds at forty metrics, collapsing the metric lines to one per category with a stated count', () => {
      const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(id => known(412, 'days')), metrics: metrics(40), labs: NO_LABS });
      expect(text.length).toBeLessThanOrEqual(COVERAGE_INDEX_MAX_CHARS);
      expect(text).toMatch(/Category 0 — 5 metrics/);
      expect(text).toContain('metric_number_00');
      expect(text).not.toContain('Metric number 0 with');
    });

    it('does not collapse while the full lines fit', () => {
      const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => ({ kind: 'unknown', reason: 'x' })), metrics: metrics(12), labs: NO_LABS });
      expect(text).toContain('Metric number 3 with');
      expect(text.length).toBeLessThanOrEqual(COVERAGE_INDEX_MAX_CHARS);
    });

    it('holds at forty metrics and a hundred and fifty lab series, naming how many were collapsed', () => {
      const text = renderCoverageIndex({ refKey: '2026-10-08', rows: rows(() => known(412, 'days')), metrics: metrics(40), labs: labs(150) });
      expect(text.length).toBeLessThanOrEqual(COVERAGE_INDEX_MAX_CHARS);
      expect(text).toMatch(/Lab category 0: \d+ series/);
      expect(text).toMatch(/\d+ earlier panel dates/);
    });
  });
});

describe('collectCoverageRows', () => {
  it('reads every capability\'s coverage once, from the question\'s context', async () => {
    const result = await collectCoverageRows(CAPABILITIES, testCtx());
    expect(result.map(r => r.id)).toEqual(CAPABILITIES.map(c => c.id));
    expect(result.every(r => r.coverage.kind !== 'withheld')).toBe(true);
  });

  it('marks a capability withheld, without reading it, when the policy does not allow its category', async () => {
    let read = 0;
    const policy: PrivacyPolicy = { allows: c => c !== 'blood-pressure' };
    const cap = { ...CAPABILITIES.find(c => c.id === 'heart.blood_pressure')!, coverage: async (): Promise<Coverage> => (read++, known(1)) };
    const out = await collectCoverageRows([cap], testCtx({ policy }));
    expect(out[0]!.coverage).toEqual({ kind: 'withheld' });
    expect(read).toBe(0);
  });

  it('reports a coverage that throws as unavailable, with nothing of the error', async () => {
    const cap = { ...CAPABILITIES[0]!, coverage: async (): Promise<Coverage> => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'); } };
    const out = await collectCoverageRows([cap], testCtx());
    expect(out[0]!.coverage.kind).toBe('unavailable');
    expect(JSON.stringify(out[0])).not.toMatch(/hunter2|10\.0\.0\.5/);
  });
});
