// ── Training plan model ─────────────────────────────────
//
// A plan describes *how any progression moves forward*. It knows nothing about a
// particular discipline, so the same shape holds a bodyweight skill progression
// (floor → decline → archer push-up), a barbell cycle (bench 80 → 85 kg with a
// periodized peak), a 10k build (weekly volume ramp and a pace target), mobility
// work, or any mix of them.
//
//   TrainingPlan
//   ├─ focusAreas[]        user-named groupings ("Push", "Squat / Bench", "Aerobic base")
//   │   └─ paths[]         one progression line, evaluated by a progression model
//   │       └─ stages[]    ordered; a stage changes the variation, the load, or the volume
//   │           └─ steps[] optional sub-ladder inside a stage (box heights, 1 → 3×3 → 3×5)
//   ├─ rules               when to progress, the light definitions, deloads, recovery gates
//   ├─ blocks[]            time periods: months, mesocycles, base/build/taper, deload weeks
//   ├─ templates[]         session templates whose slots point at paths
//   └─ schedule            cycle (any length), fixed weekdays, or N sessions a week
//
// A plan is CONFIGURATION: targets, stage choices and the dates a stage began.
// It never holds a measured set — performance is read live from the workout
// sources (src/lib/workout-sources) — so it may be stored in the database.
//
// This module has no imports, so browser code may use the types.

export type Range = [number, number];

export const PROGRESSION_MODEL_IDS = ['variation', 'load', 'percentage', 'volume', 'maintain'] as const;
export type ProgressionModelId = (typeof PROGRESSION_MODEL_IDS)[number];

export const RECOVERY_SIGNAL_IDS = ['resting_hr', 'hrv', 'sleep_hours', 'body_weight_rate', 'training_load'] as const;
export type RecoverySignalId = (typeof RECOVERY_SIGNAL_IDS)[number];

/**
 * One prescription or progression marker. Every field is optional so a dose can
 * describe reps, holds, negatives, loaded sets, distance, pace or weekly volume.
 */
export interface Dose {
  sets?: Range;
  reps?: Range;
  /** Reps, holds or distances are per side / per leg. */
  perSide?: boolean;
  load?: {
    kg?: Range;
    /** Percent of an estimated one-rep max. */
    pct1rm?: Range;
    /** Assistance (band, machine): less is harder. */
    assistanceKg?: Range;
  };
  /** Timed work, in seconds. */
  durationS?: Range;
  /** Isometric hold, in seconds. */
  holdS?: Range;
  /** Lowering time of a negative, in seconds. */
  eccentricS?: Range;
  distanceM?: Range;
  /** Pace in seconds per kilometre (lower is faster). */
  paceSPerKm?: Range;
  hrZone?: Range;
  effort?: { rpe?: Range; rir?: Range };
  weeklyVolume?: { metric: 'sets' | 'distanceM' | 'durationS'; range: Range };
}

/** How a stage recognises its sessions. */
export interface StageMatch {
  /** Exercise names (and aliases) as the workout source records them. */
  names: string[];
  /** Source exercise-template ids (e.g. Hevy template ids): the most reliable match. */
  templateIds?: string[];
  /** Apple Health workout types ("Running"), for plans with no workout source. */
  workoutTypes?: string[];
}

export interface StageStep {
  name: string;
  advanceWhen?: Dose;
}

export interface Stage {
  id: string;
  name: string;
  match: StageMatch;
  /** What to do while in this stage. */
  prescription?: Dose;
  /** The marker that earns the next stage. */
  advanceWhen?: Dose;
  /** Sessions that must meet the marker; defaults to the plan's rule. */
  qualifyingSessions?: Range;
  /** Form goals and coaching cues. */
  cues: string[];
  /** Qualitative gates no source can measure ("no elbow or wrist pain"). */
  checks: string[];
  steps?: StageStep[];
  expectedWeeks?: Range;
  notes?: string;
}

export interface PathHistoryEntry {
  stageId: string;
  stepIndex?: number;
  /** YYYY-MM-DD */
  startedOn: string;
  reason?: string;
}

export interface PathHold {
  kind: 'hold' | 'regress';
  reason: string;
  /** YYYY-MM-DD */
  since: string;
}

export interface Path {
  id: string;
  name: string;
  model: ProgressionModelId;
  /** Model-specific settings, validated by the model (see model-params.ts). */
  params?: Record<string, unknown>;
  stages: Stage[];
  currentStageId: string;
  currentStepIndex?: number;
  priority: 'primary' | 'secondary';
  history: PathHistoryEntry[];
  /** Set when progression is paused — a reported symptom, a missed block. */
  hold?: PathHold;
}

export interface FocusArea {
  id: string;
  name: string;
  paths: Path[];
}

export interface RecoveryGate {
  signal: RecoverySignalId;
  rule: 'rising' | 'falling' | 'below' | 'above';
  /** For below/above; for rising/falling, the minimum change that counts. */
  threshold?: number;
  severity: 'watch' | 'warn';
  /** Plain-language reason shown with the gate. */
  note?: string;
}

export interface PlanRules {
  /** Sessions a marker must be met for before advancing. */
  qualifyingSessions: Range;
  /** Default working effort. */
  effort?: { rpe?: Range; rir?: Range };
  /** The plan's own words for each light (shown, and given to the narrative). */
  lights: { green: string[]; yellow: string[]; red: string[] };
  doNotProgressIf: string[];
  deload?: { everyWeeks: Range; volumeReduction: Range };
  recoveryGates: RecoveryGate[];
}

export type BlockKind = 'build' | 'deload' | 'peak' | 'taper' | 'test';

export interface BlockTarget {
  pathId?: string;
  label: string;
  dose?: Dose;
}

export interface Block {
  id: string;
  name: string;
  /** 1-based week of the plan the block starts in. */
  startWeek: number;
  weeks: number;
  kind?: BlockKind;
  goals: string[];
  targets: BlockTarget[];
  /** A different schedule while this block runs (a deload week, a taper). */
  scheduleOverride?: Schedule;
}

export interface TemplateSlot {
  /** Paths this slot trains; several means "pick one" or a rotation. */
  pathIds: string[];
  dose?: Dose;
  optional?: boolean;
  /** Rotate through `pathIds` session to session instead of picking. */
  rotate?: boolean;
  note?: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  minutes?: number;
  warmup?: string[];
  slots: TemplateSlot[];
}

export type ScheduleDay = { templateIds: string[]; note?: string } | { rest: true; note?: string };

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Schedule =
  | {
      kind: 'cycle';
      /** Any length: [A, B, rest], [Full, rest], [Light full body], PPL-PPL-rest… */
      days: ScheduleDay[];
      /** Move on when a session is logged, or follow the calendar from `anchorDate`. */
      advance: 'on-completion' | 'calendar';
      /** YYYY-MM-DD; defaults to the plan's start date. */
      anchorDate?: string;
    }
  | { kind: 'weekdays'; days: Partial<Record<Weekday, ScheduleDay>> }
  | {
      kind: 'frequency';
      sessionsPerWeek: Range;
      /** Template ids, used in order. */
      rotation: string[];
      minRestHours?: number;
    };

export const PLAN_SCHEMA_VERSION = 1;

export interface TrainingPlan {
  schemaVersion: number;
  title: string;
  goal: string;
  /** Background that shapes the plan ("cutting ~1.5 lb/week", "home gym, no barbell"). */
  context: string[];
  /** YYYY-MM-DD */
  startDate: string;
  durationWeeks: number;
  focusAreas: FocusArea[];
  rules: PlanRules;
  blocks: Block[];
  templates: SessionTemplate[];
  schedule: Schedule;
}

// ── Storage records ─────────────────────────────────────

export type PlanChangeSource = 'analyst' | 'user';

export interface StoredPlan {
  id: string;
  status: 'active' | 'archived';
  plan: TrainingPlan;
  /** Bumped on every write; a write that names a stale revision is refused. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRevisionSummary {
  planId: string;
  revision: number;
  source: PlanChangeSource;
  summary: string;
  createdAt: string;
}
