// ── Capability types (design §3.2, §9.2) ────────────────
//
// Client-safe: type-only imports, plus the one constant (ALLOW_ALL) that has no
// server dependency. manifest.ts imports this file and nothing else.

import type { UnitSystem } from '../../prefs';
import type { RoutineDeps } from '../../routine/service';
import type { DataAccess } from '../dataAccess';
import type { Envelope } from './envelope';

export type CapabilityArea =
  | 'metrics'
  | 'sleep'
  | 'heart'
  | 'workouts'
  | 'training'
  | 'labs'
  | 'medications'
  | 'body'
  | 'activity'
  | 'insights'
  | 'app';

export type DataOwner = 'dataset' | 'lab-store' | 'workout-sources' | 'medications-upstream' | 'config-store' | 'computed';

/** Feeds src/lib/sources/tagging.ts: which sources a turn that used this capability came from. */
export type SourceTag = 'metric-provenance' | 'all-health' | 'lab' | 'hae' | 'workout-detail' | 'configuration';

/** Closed list; the Settings disclosure is generated from the categories in use. */
export type SendingCategory =
  | 'metric-summaries'
  | 'daily-values'
  | 'sleep-nights'
  | 'blood-pressure'
  | 'workouts'
  | 'strength-sessions'
  | 'lab-results'
  | 'medication-records'
  | 'body-goal'
  | 'profile-context'
  | 'app-status'
  | 'locations-coarse';

export type SizeClass = 'small' | 'per-day' | 'per-record' | 'per-series';

/** The part of a capability the client may import. */
export interface CapabilityManifestEntry {
  /** 'workouts.sessions' */
  id: string;
  area: CapabilityArea;
  /** 'Workout sessions' */
  title: string;
  /** 'get_workouts' */
  tool: string;
  /** 'Looking up your workouts…' */
  statusLabel: string;
  sources: SourceTag;
  category: SendingCategory;
}

export type Coverage =
  | { kind: 'known'; first: string | null; last: string | null; count: number; unit: string }
  /** Only the upstream can tell, e.g. medications before a read. */
  | { kind: 'unknown'; reason: string }
  /** The source is not configured or cannot be read. */
  | { kind: 'unavailable'; reason: string };

/** Whether the AI privacy setting lets a category reach the model. */
export interface PrivacyPolicy {
  allows(category: SendingCategory): boolean;
}

/** The only policy until the owner decides on per-category toggles (design §15, Q2). */
export const ALLOW_ALL: PrivacyPolicy = { allows: () => true };

export interface CapabilityContext {
  system: UnitSystem;
  /** REFERENCE_KEY at the start of the question. */
  refKey: string;
  /** REFERENCE_TZ. */
  tz: string;
  env: NodeJS.ProcessEnv;
  /** Per-question readers and the fetch record. */
  access: DataAccess;
  routine: RoutineDeps;
  policy: PrivacyPolicy;
}

export interface Capability<A, R> extends CapabilityManifestEntry {
  /** One or two sentences for the model: what it holds, and what it does not. */
  description: string;
  owner: DataOwner;
  /** What it mirrors; the parity test reads this. */
  mirrors: { routes?: string[]; pages?: string[]; accessors?: string[]; metrics?: string[] };
  time: 'window' | 'none';
  sizeClass: SizeClass;
  /** Default and maximum rows per call for 'per-record' and 'per-day' classes. */
  page?: { defaultLimit: number; maxLimit: number };
  /** Words a reply uses when it claims absence (the absence audit, design §5.5). */
  absenceTerms: string[];
  /** Metric ids an evidence card may cite after a successful read. */
  citesAs?: string[];
  /** Cheap: first and last day and count, or 'unknown' when only the upstream can tell. */
  coverage(ctx: CapabilityContext): Promise<Coverage>;
  read(args: A, ctx: CapabilityContext): Promise<Envelope<R>>;
}
