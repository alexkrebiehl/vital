// ── Dataset metadata shared with the browser ────────────
//
// Deliberately tiny and client-safe: it carries counts, times, host names and
// provenance sentences — never a health value, never a token. The live adapter
// (which holds the token) is a separate, server-only module.

import type { DataMode } from './dataset';
import type { ProvenanceRow } from './normalize';

/** A source-deduplication rule plus what it actually did on this dataset. */
export interface DedupeSummary {
  /** The stated rule, quoted in the provenance panel. */
  rule: string;
  droppedRecords: number;
  droppedIntervals: number;
}

/** A source that failed while another served the data. Fixed text: never a token or a value. */
export interface SourceError {
  sourceId: string;
  kind: string;
  message: string;
}

/**
 * Everything the browser needs to label the data honestly.
 */
export interface ClientDatasetMeta {
  mode: DataMode;
  live: boolean;
  /** Newest observation instant in the dataset. */
  dataAsOf: string;
  /** Newest observation's calendar day in the dataset timezone. */
  dataAsOfKey: string;
  referenceKey: string;
  windowStartKey: string;
  timezone: string;
  generatedAt: string;
  observationCount: number;
  metricCount: number;
  workouts: number;
  sources: string[];
  /** Host of the data source (never the token). */
  host: string | null;
  cacheTtlSeconds: number;
  dedupe: DedupeSummary | null;
  provenance: ProvenanceRow[];
  /** Human sentence for the freshness control. */
  summary: string;
  /** Present only when a source failed and the other's data was served. */
  sourceErrors?: SourceError[];
}
