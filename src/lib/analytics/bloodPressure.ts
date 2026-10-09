// ── Blood pressure: window and reference threshold ──────
//
// The Health page shows only the last week of readings, each with its date, and
// flags any reading above 120/80.
//
// 120/80 mmHg is a commonly cited *reference threshold*. It is not a diagnosis,
// it is not specific to any one person, and a reading above it is not by itself
// a statement about that person's health — the wording belongs in the UI, and
// the rule itself lives here so it is testable on its own.

import type { BloodPressureObservation } from '../metrics/types';
import { containsDay, type DayWindow } from './windows';
import { mean, median, stddev } from './stats';

export const BP_REFERENCE_THRESHOLD = { systolic: 120, diastolic: 80 } as const;

/** Readings that fall inside the window, oldest first. */
export function bloodPressureInWindow(
  records: BloodPressureObservation[],
  win: DayWindow
): BloodPressureObservation[] {
  return records.filter(r => containsDay(win, r.date));
}

/**
 * True when a reading is above the reference threshold on either number —
 * systolic above 120 **or** diastolic above 80.
 */
export function isAboveBloodPressureReference(
  reading: Pick<BloodPressureObservation, 'systolic' | 'diastolic'>
): boolean {
  return (
    reading.systolic > BP_REFERENCE_THRESHOLD.systolic ||
    reading.diastolic > BP_REFERENCE_THRESHOLD.diastolic
  );
}

// ── Per-series statistics ───────────────────────────────
//
// A reading is a PAIR. Every statistic is computed for systolic and for
// diastolic separately and shown as a pair; one number is never labelled "blood
// pressure". A reading missing either number is dropped, never shown half.

/** True when both numbers of a reading are real, finite numbers. */
export function isCompleteBloodPressureReading(r: Partial<BloodPressureObservation>): boolean {
  return Number.isFinite(r.systolic) && Number.isFinite(r.diastolic);
}

export function completeBloodPressureReadings(records: BloodPressureObservation[]): BloodPressureObservation[] {
  return records.filter(isCompleteBloodPressureReading);
}

export interface SeriesStats {
  mean: number;
  min: number;
  max: number;
  median: number;
}

export interface BloodPressureStats {
  count: number;
  systolic: SeriesStats;
  diastolic: SeriesStats;
}

function seriesStats(values: number[]): SeriesStats {
  return { mean: mean(values), min: Math.min(...values), max: Math.max(...values), median: median(values) };
}

/** Mean, min, max and median of each series; null when there is no complete reading. */
export function bloodPressureStats(records: BloodPressureObservation[]): BloodPressureStats | null {
  const usable = completeBloodPressureReadings(records);
  if (usable.length === 0) return null;
  return {
    count: usable.length,
    systolic: seriesStats(usable.map(r => r.systolic)),
    diastolic: seriesStats(usable.map(r => r.diastolic)),
  };
}

export interface BaselineBand {
  mean: number;
  low: number;
  high: number;
}

export interface BloodPressureBaseline {
  count: number;
  systolic: BaselineBand;
  diastolic: BaselineBand;
}

function band(values: number[]): BaselineBand {
  const m = mean(values);
  const sd = stddev(values);
  return { mean: m, low: Number.isFinite(sd) ? m - sd : m, high: Number.isFinite(sd) ? m + sd : m };
}

/** Mean ± one standard deviation for each series (a single reading has no spread). */
export function bloodPressureBaseline(records: BloodPressureObservation[]): BloodPressureBaseline | null {
  const usable = completeBloodPressureReadings(records);
  if (usable.length === 0) return null;
  return {
    count: usable.length,
    systolic: band(usable.map(r => r.systolic)),
    diastolic: band(usable.map(r => r.diastolic)),
  };
}

/** Difference of the two window means, per series; null unless both sides have readings. */
export function bloodPressureChange(
  current: BloodPressureObservation[],
  baseline: BloodPressureObservation[]
): { systolic: number; diastolic: number } | null {
  const now = bloodPressureStats(current);
  const before = bloodPressureStats(baseline);
  if (!now || !before) return null;
  return {
    systolic: now.systolic.mean - before.systolic.mean,
    diastolic: now.diastolic.mean - before.diastolic.mean,
  };
}
