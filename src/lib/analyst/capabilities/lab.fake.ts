// ── A lab source for tests: dated, synthetic, no store behind it ────────────

import type { LabSeriesInput, LabSeriesObservationInput, LabSourceInput } from '../labSnapshot';

export function obs(on: string, value: number | null, extra: Partial<LabSeriesObservationInput> = {}): LabSeriesObservationInput {
  const high = value !== null && value > 200;
  return {
    on,
    value,
    valueText: null,
    unit: 'mg/dL',
    printedRefText: '<200 mg/dL',
    interval: { low: null, high: 200, origin: 'report', refText: '<200 mg/dL', refBasis: null, bandNote: null, band: null },
    status: high ? 'out_high' : 'in_range',
    statusLabel: high ? 'High' : 'In range',
    tone: high ? 'bad' : 'good',
    ...extra,
  } as LabSeriesObservationInput;
}

export function labSeries(key: string, name: string, category: string, points: LabSeriesObservationInput[]): LabSeriesInput {
  return { seriesKey: key, analyteKey: key, displayName: name, category, specimen: 'other', registered: false, unit: 'mg/dL', points };
}

export function labSource(series: LabSeriesInput[]): LabSourceInput {
  return { available: true, reason: null, documents: 3, totalObservations: series.reduce((n, s) => n + s.points.length, 0), collisions: 0, series };
}

/**
 * Three panels: 10 Mar, 15 Jun and 29 Sep 2026. LDL was measured on all three,
 * hemoglobin only in March, ALT only in September.
 */
export const DATED_LABS: LabSourceInput = labSource([
  labSeries('ldl', 'LDL cholesterol', 'Lipids', [obs('2026-03-10', 120), obs('2026-06-15', 95), obs('2026-09-29', 210)]),
  labSeries('hemoglobin', 'Hemoglobin', 'CBC', [obs('2026-03-10', 10.9, { unit: 'g/dL' })]),
  labSeries('alt', 'ALT', 'Liver', [obs('2026-09-29', 41, { unit: 'U/L' })]),
]);
