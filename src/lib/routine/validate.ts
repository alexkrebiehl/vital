// ── Training plan validation ────────────────────────────
//
// `validatePlan` is the only way a plan becomes a `TrainingPlan`: the analyst's
// create/update tools, the API routes and the store all pass through it. It
// both checks and normalizes — missing ids are derived from names, optional
// arrays default to empty, a path with no current stage starts at its first — so
// a model can send a reasonable plan without knowing every bookkeeping field.
//
// Every error names the exact field and says what would be accepted, because the
// errors are handed back to the model as a tool result to fix and retry.
//
// Pure and import-light: safe in any bundle.

import { validateModelParams } from './model-params';
import {
  PLAN_SCHEMA_VERSION,
  PROGRESSION_MODEL_IDS,
  RECOVERY_SIGNAL_IDS,
  WEEKDAYS,
  type Block,
  type BlockKind,
  type Dose,
  type FocusArea,
  type Path,
  type PathHistoryEntry,
  type PathHold,
  type Phase,
  type PhaseTarget,
  type PlanRules,
  type ProgressionModelId,
  type Range,
  type RecoveryGate,
  type Schedule,
  type ScheduleDay,
  type SessionTemplate,
  type Stage,
  type StageMatch,
  type TemplateSlot,
  type TrainingPlan,
  type Weekday,
} from './types';

export const PLAN_LIMITS = {
  maxWeeks: 104,
  focusAreas: 8,
  pathsPerArea: 4,
  stagesPerPath: 16,
  stepsPerStage: 8,
  blocks: 52,
  phases: 16,
  targetsPerPhase: 12,
  templates: 12,
  slotsPerTemplate: 8,
  cycleDays: 14,
  stringItems: 16,
  text: 400,
  title: 120,
} as const;

export type PlanValidation = { ok: true; plan: TrainingPlan } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Path ids that would collide with the routine's own routes (/workouts/routine/workouts/…, /api/routine/undo). */
const RESERVED_PATH_IDS = ['undo', 'workouts'];

class Reader {
  errors: string[] = [];
  private ids = new Map<string, string>();

  fail(where: string, message: string): void {
    if (this.errors.length < 40) this.errors.push(`${where}: ${message}`);
  }

  obj(value: unknown, where: string): Obj | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.fail(where, 'must be an object.');
      return null;
    }
    return value as Obj;
  }

  arr(value: unknown, where: string, max: number, required = false): unknown[] {
    if (value === undefined || value === null) {
      if (required) this.fail(where, 'is required (an array).');
      return [];
    }
    if (!Array.isArray(value)) {
      this.fail(where, 'must be an array.');
      return [];
    }
    if (value.length > max) {
      this.fail(where, `has ${value.length} items; at most ${max} are allowed.`);
      return value.slice(0, max);
    }
    return value;
  }

  str(value: unknown, where: string, opts: { required?: boolean; max?: number } = {}): string {
    const max = opts.max ?? PLAN_LIMITS.text;
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.fail(where, 'is required (text).');
      return '';
    }
    if (typeof value !== 'string') {
      this.fail(where, 'must be text.');
      return '';
    }
    const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (cleaned.length > max) {
      this.fail(where, `is ${cleaned.length} characters; at most ${max}.`);
      return cleaned.slice(0, max);
    }
    return cleaned;
  }

  strings(value: unknown, where: string): string[] {
    return this.arr(value, where, PLAN_LIMITS.stringItems)
      .map((v, i) => this.str(v, `${where}[${i}]`))
      .filter(Boolean);
  }

  num(value: unknown, where: string, min: number, max: number, opts: { integer?: boolean } = {}): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (opts.integer && !Number.isInteger(value))) {
      this.fail(where, `must be ${opts.integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
      return undefined;
    }
    return value;
  }

  /** A [min, max] pair; a single number n is read as [n, n]. */
  range(value: unknown, where: string, min: number, max: number): Range | undefined {
    if (value === undefined || value === null) return undefined;
    const pair = typeof value === 'number' ? [value, value] : value;
    if (!Array.isArray(pair) || pair.length !== 2) {
      this.fail(where, `must be [min, max] (numbers from ${min} to ${max}) or a single number.`);
      return undefined;
    }
    const [a, b] = pair;
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a < min || b > max || a > b) {
      this.fail(where, `must be [min, max] with ${min} ≤ min ≤ max ≤ ${max}.`);
      return undefined;
    }
    return [a, b];
  }

  date(value: unknown, where: string, required = false): string | undefined {
    if (value === undefined || value === null || value === '') {
      if (required) this.fail(where, 'is required (YYYY-MM-DD).');
      return undefined;
    }
    if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      this.fail(where, 'must be a date as YYYY-MM-DD.');
      return undefined;
    }
    return value;
  }

  /** A unique id within `scope`, derived from `name` when absent. */
  id(value: unknown, name: string, where: string, scope: string): string {
    let id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (id && !ID_RE.test(id)) {
      this.fail(where, 'must be lowercase letters, digits and dashes (at most 48), starting with a letter or digit.');
      id = '';
    }
    if (!id) id = slugify(name) || scope;
    let unique = id;
    for (let n = 2; this.ids.has(`${scope}:${unique}`); n++) {
      if (typeof value === 'string' && value.trim()) {
        this.fail(where, `"${id}" is used twice; ids must be unique.`);
        return id;
      }
      unique = `${id}-${n}`.slice(0, 48);
    }
    this.ids.set(`${scope}:${unique}`, where);
    return unique;
  }

  enumOf<T extends string>(value: unknown, where: string, allowed: readonly T[], fallback?: T): T | undefined {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(where, `must be one of: ${allowed.join(', ')}.`);
      return fallback;
    }
    return value as T;
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

function readDose(r: Reader, value: unknown, where: string): Dose | undefined {
  if (value === undefined || value === null) return undefined;
  const o = r.obj(value, where);
  if (!o) return undefined;
  const known = new Set(['sets', 'reps', 'perSide', 'load', 'durationS', 'holdS', 'eccentricS', 'distanceM', 'paceSPerKm', 'hrZone', 'effort', 'weeklyVolume']);
  for (const key of Object.keys(o)) if (!known.has(key)) r.fail(`${where}.${key}`, `is not a dose field (allowed: ${[...known].join(', ')}).`);

  const dose: Dose = {};
  const set = <K extends keyof Dose>(k: K, v: Dose[K] | undefined) => {
    if (v !== undefined) dose[k] = v;
  };
  set('sets', r.range(o.sets, `${where}.sets`, 1, 20));
  set('reps', r.range(o.reps, `${where}.reps`, 1, 1000));
  if (o.perSide !== undefined) dose.perSide = o.perSide === true;
  if (o.load !== undefined) {
    const l = r.obj(o.load, `${where}.load`);
    if (l) {
      const load: NonNullable<Dose['load']> = {};
      const kg = r.range(l.kg, `${where}.load.kg`, 0, 1000);
      const pct = r.range(l.pct1rm, `${where}.load.pct1rm`, 1, 120);
      const assist = r.range(l.assistanceKg, `${where}.load.assistanceKg`, 0, 300);
      if (kg) load.kg = kg;
      if (pct) load.pct1rm = pct;
      if (assist) load.assistanceKg = assist;
      if (Object.keys(load).length) dose.load = load;
    }
  }
  set('durationS', r.range(o.durationS, `${where}.durationS`, 1, 86_400));
  set('holdS', r.range(o.holdS, `${where}.holdS`, 1, 3_600));
  set('eccentricS', r.range(o.eccentricS, `${where}.eccentricS`, 1, 60));
  set('distanceM', r.range(o.distanceM, `${where}.distanceM`, 1, 500_000));
  set('paceSPerKm', r.range(o.paceSPerKm, `${where}.paceSPerKm`, 60, 1_800));
  set('hrZone', r.range(o.hrZone, `${where}.hrZone`, 1, 5));
  if (o.effort !== undefined) {
    const e = r.obj(o.effort, `${where}.effort`);
    if (e) {
      const effort: NonNullable<Dose['effort']> = {};
      const rpe = r.range(e.rpe, `${where}.effort.rpe`, 1, 10);
      const rir = r.range(e.rir, `${where}.effort.rir`, 0, 10);
      if (rpe) effort.rpe = rpe;
      if (rir) effort.rir = rir;
      if (Object.keys(effort).length) dose.effort = effort;
    }
  }
  if (o.weeklyVolume !== undefined) {
    const w = r.obj(o.weeklyVolume, `${where}.weeklyVolume`);
    if (w) {
      const metric = r.enumOf(w.metric, `${where}.weeklyVolume.metric`, ['sets', 'distanceM', 'durationS'] as const);
      const range = r.range(w.range, `${where}.weeklyVolume.range`, 0, 10_000_000);
      if (metric && range) dose.weeklyVolume = { metric, range };
      else if (!metric || !range) r.fail(`${where}.weeklyVolume`, 'needs both metric and range.');
    }
  }
  return dose;
}

function readMatch(r: Reader, value: unknown, where: string, stageName: string): StageMatch {
  const o = value === undefined ? {} : r.obj(value, where) ?? {};
  const names = r.strings(o.names, `${where}.names`);
  const templateIds = r.strings(o.templateIds, `${where}.templateIds`);
  const workoutTypes = r.strings(o.workoutTypes, `${where}.workoutTypes`);
  const match: StageMatch = { names: names.length || templateIds.length || workoutTypes.length ? names : [stageName] };
  if (templateIds.length) match.templateIds = templateIds;
  if (workoutTypes.length) match.workoutTypes = workoutTypes;
  return match;
}

function readStage(r: Reader, value: unknown, where: string, pathId: string): Stage | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const name = r.str(o.name, `${where}.name`, { required: true, max: PLAN_LIMITS.title });
  const stage: Stage = {
    id: r.id(o.id, name, `${where}.id`, `stage:${pathId}`),
    name,
    match: readMatch(r, o.match, `${where}.match`, name),
    cues: r.strings(o.cues, `${where}.cues`),
    checks: r.strings(o.checks, `${where}.checks`),
  };
  const prescription = readDose(r, o.prescription, `${where}.prescription`);
  const advanceWhen = readDose(r, o.advanceWhen, `${where}.advanceWhen`);
  const qualifying = r.range(o.qualifyingSessions, `${where}.qualifyingSessions`, 1, 12);
  const expected = r.range(o.expectedWeeks, `${where}.expectedWeeks`, 0, 104);
  const notes = r.str(o.notes, `${where}.notes`);
  if (prescription) stage.prescription = prescription;
  if (advanceWhen) stage.advanceWhen = advanceWhen;
  if (qualifying) stage.qualifyingSessions = qualifying;
  if (expected) stage.expectedWeeks = expected;
  if (notes) stage.notes = notes;
  const steps = r.arr(o.steps, `${where}.steps`, PLAN_LIMITS.stepsPerStage);
  if (steps.length) {
    stage.steps = steps
      .map((s, i) => {
        const so = r.obj(s, `${where}.steps[${i}]`);
        if (!so) return null;
        const step: NonNullable<Stage['steps']>[number] = { name: r.str(so.name, `${where}.steps[${i}].name`, { required: true, max: PLAN_LIMITS.title }) };
        const adv = readDose(r, so.advanceWhen, `${where}.steps[${i}].advanceWhen`);
        if (adv) step.advanceWhen = adv;
        return step;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }
  return stage;
}

function readPath(r: Reader, value: unknown, where: string): Path | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const name = r.str(o.name, `${where}.name`, { required: true, max: PLAN_LIMITS.title });
  const given = typeof o.id === 'string' && o.id.trim() ? o.id.trim().toLowerCase() : undefined;
  if (given && RESERVED_PATH_IDS.includes(given)) {
    r.fail(`${where}.id`, `"${given}" is reserved for the routine's own pages; use another id, e.g. "${given}-path".`);
  }
  const derived = slugify(name);
  const id = r.id(given ?? (RESERVED_PATH_IDS.includes(derived) ? `${derived}-path` : o.id), name, `${where}.id`, 'path');
  const model = r.enumOf<ProgressionModelId>(o.model, `${where}.model`, PROGRESSION_MODEL_IDS, 'variation')!;
  for (const e of validateModelParams(model, o.params, where)) r.errors.push(e);

  const stages = r
    .arr(o.stages, `${where}.stages`, PLAN_LIMITS.stagesPerPath, true)
    .map((s, i) => readStage(r, s, `${where}.stages[${i}]`, id))
    .filter((s): s is Stage => s !== null);
  if (stages.length === 0) r.fail(`${where}.stages`, 'needs at least one stage.');

  let currentStageId = typeof o.currentStageId === 'string' ? o.currentStageId : stages[0]?.id ?? '';
  const current = stages.find(s => s.id === currentStageId);
  if (!current && stages.length) {
    r.fail(`${where}.currentStageId`, `"${currentStageId}" is not one of this path's stages (${stages.map(s => s.id).join(', ')}).`);
    currentStageId = stages[0].id;
  }

  const path: Path = {
    id,
    name,
    model,
    stages,
    currentStageId,
    priority: r.enumOf(o.priority, `${where}.priority`, ['primary', 'secondary'] as const, 'primary')!,
    history: [],
  };
  if (o.params && typeof o.params === 'object' && Object.keys(o.params).length) path.params = o.params as Record<string, unknown>;

  const stepIndex = r.num(o.currentStepIndex, `${where}.currentStepIndex`, 0, PLAN_LIMITS.stepsPerStage - 1, { integer: true });
  const stepCount = stages.find(s => s.id === currentStageId)?.steps?.length ?? 0;
  if (stepIndex !== undefined) {
    if (stepIndex >= stepCount) r.fail(`${where}.currentStepIndex`, `the current stage has ${stepCount} step(s).`);
    else path.currentStepIndex = stepIndex;
  }

  path.history = r
    .arr(o.history, `${where}.history`, 64)
    .map((h, i): PathHistoryEntry | null => {
      const ho = r.obj(h, `${where}.history[${i}]`);
      if (!ho) return null;
      const stageId = r.str(ho.stageId, `${where}.history[${i}].stageId`, { required: true, max: 48 });
      const startedOn = r.date(ho.startedOn, `${where}.history[${i}].startedOn`, true);
      if (stageId && !stages.some(s => s.id === stageId)) r.fail(`${where}.history[${i}].stageId`, `"${stageId}" is not a stage of this path.`);
      if (!stageId || !startedOn) return null;
      const entry: PathHistoryEntry = { stageId, startedOn };
      const si = r.num(ho.stepIndex, `${where}.history[${i}].stepIndex`, 0, PLAN_LIMITS.stepsPerStage - 1, { integer: true });
      if (si !== undefined) entry.stepIndex = si;
      const reason = r.str(ho.reason, `${where}.history[${i}].reason`);
      if (reason) entry.reason = reason;
      return entry;
    })
    .filter((h): h is PathHistoryEntry => h !== null)
    .sort((a, b) => a.startedOn.localeCompare(b.startedOn));

  if (o.hold !== undefined && o.hold !== null) {
    const ho = r.obj(o.hold, `${where}.hold`);
    if (ho) {
      const hold: PathHold = {
        kind: r.enumOf(ho.kind, `${where}.hold.kind`, ['hold', 'regress'] as const, 'hold')!,
        reason: r.str(ho.reason, `${where}.hold.reason`, { required: true }),
        since: r.date(ho.since, `${where}.hold.since`, true) ?? '',
      };
      if (hold.reason && hold.since) path.hold = hold;
    }
  }
  return path;
}

function readRules(r: Reader, value: unknown, where: string): PlanRules {
  const o = value === undefined ? {} : r.obj(value, where) ?? {};
  const lights = o.lights === undefined ? {} : r.obj(o.lights, `${where}.lights`) ?? {};
  const rules: PlanRules = {
    qualifyingSessions: r.range(o.qualifyingSessions, `${where}.qualifyingSessions`, 1, 12) ?? [2, 3],
    lights: {
      green: r.strings(lights.green, `${where}.lights.green`),
      yellow: r.strings(lights.yellow, `${where}.lights.yellow`),
      red: r.strings(lights.red, `${where}.lights.red`),
    },
    doNotProgressIf: r.strings(o.doNotProgressIf, `${where}.doNotProgressIf`),
    recoveryGates: r
      .arr(o.recoveryGates, `${where}.recoveryGates`, 12)
      .map((g, i): RecoveryGate | null => {
        const go = r.obj(g, `${where}.recoveryGates[${i}]`);
        if (!go) return null;
        const signal = r.enumOf(go.signal, `${where}.recoveryGates[${i}].signal`, RECOVERY_SIGNAL_IDS);
        const rule = r.enumOf(go.rule, `${where}.recoveryGates[${i}].rule`, ['rising', 'falling', 'below', 'above'] as const);
        if (!signal || !rule) return null;
        const gate: RecoveryGate = {
          signal,
          rule,
          severity: r.enumOf(go.severity, `${where}.recoveryGates[${i}].severity`, ['watch', 'warn'] as const, 'watch')!,
        };
        const threshold = r.num(go.threshold, `${where}.recoveryGates[${i}].threshold`, -1000, 1000);
        if (threshold !== undefined) gate.threshold = threshold;
        else if (rule === 'below' || rule === 'above') r.fail(`${where}.recoveryGates[${i}].threshold`, `is required for "${rule}".`);
        const note = r.str(go.note, `${where}.recoveryGates[${i}].note`);
        if (note) gate.note = note;
        return gate;
      })
      .filter((g): g is RecoveryGate => g !== null),
  };
  if (o.effort !== undefined) {
    const e = r.obj(o.effort, `${where}.effort`);
    if (e) {
      const rpe = r.range(e.rpe, `${where}.effort.rpe`, 1, 10);
      const rir = r.range(e.rir, `${where}.effort.rir`, 0, 10);
      if (rpe || rir) rules.effort = { ...(rpe ? { rpe } : {}), ...(rir ? { rir } : {}) };
    }
  }
  if (o.deload !== undefined && o.deload !== null) {
    const d = r.obj(o.deload, `${where}.deload`);
    if (d) {
      const everyWeeks = r.range(d.everyWeeks, `${where}.deload.everyWeeks`, 1, 26);
      const volumeReduction = r.range(d.volumeReduction, `${where}.deload.volumeReduction`, 0, 0.9) ?? [0.3, 0.5];
      if (everyWeeks) rules.deload = { everyWeeks, volumeReduction };
      else r.fail(`${where}.deload.everyWeeks`, 'is required when a deload rule is given.');
    }
  }
  return rules;
}

function readScheduleDay(r: Reader, value: unknown, where: string, templateIds: Set<string>): ScheduleDay | null {
  if (value === 'rest') return { rest: true };
  if (typeof value === 'string') {
    if (!templateIds.has(value)) r.fail(where, `"${value}" is not a session template id (${[...templateIds].join(', ') || 'none defined'}) or "rest".`);
    return { templateIds: [value] };
  }
  const o = r.obj(value, where);
  if (!o) return null;
  const note = r.str(o.note, `${where}.note`);
  if (o.rest === true) return note ? { rest: true, note } : { rest: true };
  const ids = r.strings(o.templateIds, `${where}.templateIds`);
  if (ids.length === 0) r.fail(where, 'must be "rest", a template id, {rest: true} or {templateIds: [...]}.');
  for (const id of ids) if (!templateIds.has(id)) r.fail(`${where}.templateIds`, `"${id}" is not a session template id.`);
  return note ? { templateIds: ids, note } : { templateIds: ids };
}

function readSchedule(r: Reader, value: unknown, where: string, templateIds: Set<string>): Schedule | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const kind = r.enumOf(o.kind, `${where}.kind`, ['cycle', 'weekdays', 'frequency'] as const);
  if (kind === 'cycle') {
    const days = r
      .arr(o.days, `${where}.days`, PLAN_LIMITS.cycleDays, true)
      .map((d, i) => readScheduleDay(r, d, `${where}.days[${i}]`, templateIds))
      .filter((d): d is ScheduleDay => d !== null);
    if (days.length === 0) r.fail(`${where}.days`, 'needs at least one day.');
    else if (days.every(d => 'rest' in d)) r.fail(`${where}.days`, 'must include at least one training day.');
    const schedule: Schedule = {
      kind,
      days,
      advance: r.enumOf(o.advance, `${where}.advance`, ['on-completion', 'calendar'] as const, 'on-completion')!,
    };
    const anchor = r.date(o.anchorDate, `${where}.anchorDate`);
    if (anchor) schedule.anchorDate = anchor;
    return schedule;
  }
  if (kind === 'weekdays') {
    const d = r.obj(o.days, `${where}.days`) ?? {};
    const days: Partial<Record<Weekday, ScheduleDay>> = {};
    for (const [key, v] of Object.entries(d)) {
      if (!WEEKDAYS.includes(key as Weekday)) {
        r.fail(`${where}.days.${key}`, `is not a weekday (${WEEKDAYS.join(', ')}).`);
        continue;
      }
      const day = readScheduleDay(r, v, `${where}.days.${key}`, templateIds);
      if (day) days[key as Weekday] = day;
    }
    if (!Object.values(days).some(day => day && !('rest' in day))) r.fail(`${where}.days`, 'must include at least one training day.');
    return { kind, days };
  }
  if (kind === 'frequency') {
    const rotation = r.strings(o.rotation, `${where}.rotation`);
    if (rotation.length === 0) r.fail(`${where}.rotation`, 'needs at least one session template id.');
    for (const id of rotation) if (!templateIds.has(id)) r.fail(`${where}.rotation`, `"${id}" is not a session template id.`);
    const schedule: Schedule = {
      kind,
      sessionsPerWeek: r.range(o.sessionsPerWeek, `${where}.sessionsPerWeek`, 1, 14) ?? [3, 3],
      rotation,
    };
    const rest = r.num(o.minRestHours, `${where}.minRestHours`, 0, 168);
    if (rest !== undefined) schedule.minRestHours = rest;
    return schedule;
  }
  return null;
}

function readTemplate(r: Reader, value: unknown, where: string, pathIds: Set<string>): SessionTemplate | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const name = r.str(o.name, `${where}.name`, { required: true, max: PLAN_LIMITS.title });
  const template: SessionTemplate = {
    id: r.id(o.id, name, `${where}.id`, 'template'),
    name,
    slots: r
      .arr(o.slots, `${where}.slots`, PLAN_LIMITS.slotsPerTemplate, true)
      .map((s, i): TemplateSlot | null => {
        const so = r.obj(s, `${where}.slots[${i}]`);
        if (!so) return null;
        const ids = r.strings(so.pathIds, `${where}.slots[${i}].pathIds`);
        if (ids.length === 0) r.fail(`${where}.slots[${i}].pathIds`, 'needs at least one path id.');
        for (const id of ids) if (!pathIds.has(id)) r.fail(`${where}.slots[${i}].pathIds`, `"${id}" is not a path id (${[...pathIds].join(', ')}).`);
        const slot: TemplateSlot = { pathIds: ids };
        const dose = readDose(r, so.dose, `${where}.slots[${i}].dose`);
        if (dose) slot.dose = dose;
        if (so.optional === true) slot.optional = true;
        if (so.rotate === true) slot.rotate = true;
        const note = r.str(so.note, `${where}.slots[${i}].note`);
        if (note) slot.note = note;
        return slot;
      })
      .filter((s): s is TemplateSlot => s !== null),
  };
  const minutes = r.num(o.minutes, `${where}.minutes`, 1, 600);
  if (minutes !== undefined) template.minutes = minutes;
  const warmup = r.strings(o.warmup, `${where}.warmup`);
  if (warmup.length) template.warmup = warmup;
  return template;
}

function readBlock(
  r: Reader,
  value: unknown,
  where: string,
  durationWeeks: number,
  pathIds: Set<string>,
  templateIds: Set<string>
): Block | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const name = r.str(o.name, `${where}.name`, { required: true, max: PLAN_LIMITS.title });
  const startWeek = r.num(o.startWeek, `${where}.startWeek`, 1, PLAN_LIMITS.maxWeeks, { integer: true }) ?? 1;
  const weeks = r.num(o.weeks, `${where}.weeks`, 1, PLAN_LIMITS.maxWeeks, { integer: true }) ?? 1;
  if (startWeek + weeks - 1 > durationWeeks) {
    r.fail(where, `runs to week ${startWeek + weeks - 1}, past the plan's ${durationWeeks} weeks.`);
  }
  const block: Block = {
    id: r.id(o.id, name, `${where}.id`, 'block'),
    name,
    startWeek,
    weeks,
    goals: r.strings(o.goals, `${where}.goals`),
    targets: r
      .arr(o.targets, `${where}.targets`, 24)
      .map((t, i) => {
        const to = r.obj(t, `${where}.targets[${i}]`);
        if (!to) return null;
        const target: Block['targets'][number] = { label: r.str(to.label, `${where}.targets[${i}].label`, { required: true }) };
        if (to.pathId !== undefined) {
          const pid = r.str(to.pathId, `${where}.targets[${i}].pathId`, { max: 48 });
          if (pid && !pathIds.has(pid)) r.fail(`${where}.targets[${i}].pathId`, `"${pid}" is not a path id.`);
          if (pid) target.pathId = pid;
        }
        const dose = readDose(r, to.dose, `${where}.targets[${i}].dose`);
        if (dose) target.dose = dose;
        return target;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  };
  const kind = r.enumOf<BlockKind>(o.kind, `${where}.kind`, ['build', 'deload', 'peak', 'taper', 'test'] as const);
  if (kind) block.kind = kind;
  if (o.scheduleOverride !== undefined && o.scheduleOverride !== null) {
    const s = readSchedule(r, o.scheduleOverride, `${where}.scheduleOverride`, templateIds);
    if (s) block.scheduleOverride = s;
  }
  return block;
}

function readPhase(r: Reader, value: unknown, where: string, paths: Map<string, Path>): Phase | null {
  const o = r.obj(value, where);
  if (!o) return null;
  const name = r.str(o.name, `${where}.name`, { required: true, max: PLAN_LIMITS.title });
  const phase: Phase = {
    id: r.id(o.id, name, `${where}.id`, 'phase'),
    name,
    goals: r.strings(o.goals, `${where}.goals`),
    targets: r
      .arr(o.targets, `${where}.targets`, PLAN_LIMITS.targetsPerPhase)
      .map((t, i): PhaseTarget | null => {
        const at = `${where}.targets[${i}]`;
        const to = r.obj(t, at);
        if (!to) return null;
        const target: PhaseTarget = { label: r.str(to.label, `${at}.label`, { required: true }) };
        if (to.pathId !== undefined) {
          const pid = r.str(to.pathId, `${at}.pathId`, { max: 48 });
          const path = paths.get(pid);
          if (pid && !path) r.fail(`${at}.pathId`, `"${pid}" is not a path id (${[...paths.keys()].join(', ')}).`);
          if (pid) target.pathId = pid;
          if (to.stageId !== undefined) {
            const sid = r.str(to.stageId, `${at}.stageId`, { max: 48 });
            if (path && sid && !path.stages.some(s => s.id === sid)) {
              r.fail(`${at}.stageId`, `"${sid}" is not a stage of path "${pid}" (${path.stages.map(s => s.id).join(', ')}).`);
            }
            if (sid) {
              target.stageId = sid;
              target.reach = r.enumOf(to.reach, `${at}.reach`, ['started', 'mastered'] as const, 'mastered');
            }
          }
        } else if (to.stageId !== undefined) {
          r.fail(`${at}.stageId`, 'needs a pathId.');
        }
        const dose = readDose(r, to.dose, `${at}.dose`);
        if (dose) {
          if (!target.pathId) r.fail(`${at}.dose`, 'needs a pathId to be checked against sessions.');
          target.dose = dose;
        }
        if (to.optional === true) target.optional = true;
        return target;
      })
      .filter((t): t is PhaseTarget => t !== null),
  };
  const expected = r.range(o.expectedWeeks, `${where}.expectedWeeks`, 0, 104);
  if (expected) phase.expectedWeeks = expected;
  const notes = r.str(o.notes, `${where}.notes`);
  if (notes) phase.notes = notes;
  return phase;
}

/** Check and normalize a whole plan. */
export function validatePlan(input: unknown): PlanValidation {
  const r = new Reader();
  const o = r.obj(input, 'plan');
  if (!o) return { ok: false, errors: r.errors };

  const title = r.str(o.title, 'plan.title', { required: true, max: PLAN_LIMITS.title });
  const goal = r.str(o.goal, 'plan.goal', { required: true });
  const startDate = r.date(o.startDate, 'plan.startDate', true) ?? '';
  const durationWeeks = r.num(o.durationWeeks, 'plan.durationWeeks', 1, PLAN_LIMITS.maxWeeks, { integer: true });
  if (durationWeeks === undefined && o.durationWeeks === undefined) r.fail('plan.durationWeeks', `is required (1–${PLAN_LIMITS.maxWeeks}).`);
  const weeks = durationWeeks ?? 1;

  const focusAreas = r
    .arr(o.focusAreas, 'plan.focusAreas', PLAN_LIMITS.focusAreas, true)
    .map((a, i): FocusArea | null => {
      const ao = r.obj(a, `plan.focusAreas[${i}]`);
      if (!ao) return null;
      const name = r.str(ao.name, `plan.focusAreas[${i}].name`, { required: true, max: PLAN_LIMITS.title });
      const area: FocusArea = {
        id: r.id(ao.id, name, `plan.focusAreas[${i}].id`, 'area'),
        name,
        paths: r
          .arr(ao.paths, `plan.focusAreas[${i}].paths`, PLAN_LIMITS.pathsPerArea, true)
          .map((p, j) => readPath(r, p, `plan.focusAreas[${i}].paths[${j}]`))
          .filter((p): p is Path => p !== null),
      };
      if (area.paths.length === 0) r.fail(`plan.focusAreas[${i}].paths`, 'needs at least one path.');
      return area;
    })
    .filter((a): a is FocusArea => a !== null);
  if (focusAreas.length === 0) r.fail('plan.focusAreas', 'needs at least one focus area.');

  const pathIds = new Set(focusAreas.flatMap(a => a.paths.map(p => p.id)));
  const templates = r
    .arr(o.templates, 'plan.templates', PLAN_LIMITS.templates, true)
    .map((t, i) => readTemplate(r, t, `plan.templates[${i}]`, pathIds))
    .filter((t): t is SessionTemplate => t !== null);
  if (templates.length === 0) r.fail('plan.templates', 'needs at least one session template.');
  const templateIds = new Set(templates.map(t => t.id));

  const schedule = o.schedule === undefined
    ? (r.fail('plan.schedule', 'is required: {kind:"cycle", days:[…]}, {kind:"weekdays", days:{mon:…}} or {kind:"frequency", sessionsPerWeek:[3,4], rotation:[…]}.'), null)
    : readSchedule(r, o.schedule, 'plan.schedule', templateIds);

  const pathsById = new Map(focusAreas.flatMap(a => a.paths.map(p => [p.id, p] as const)));
  const phases = r
    .arr(o.phases, 'plan.phases', PLAN_LIMITS.phases)
    .map((p, i) => readPhase(r, p, `plan.phases[${i}]`, pathsById))
    .filter((p): p is Phase => p !== null);

  const blocks = r
    .arr(o.blocks, 'plan.blocks', PLAN_LIMITS.blocks)
    .map((b, i) => readBlock(r, b, `plan.blocks[${i}]`, weeks, pathIds, templateIds))
    .filter((b): b is Block => b !== null)
    .sort((a, b) => a.startWeek - b.startWeek);

  const plan: TrainingPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title,
    goal,
    context: r.strings(o.context, 'plan.context'),
    startDate,
    durationWeeks: weeks,
    focusAreas,
    rules: readRules(r, o.rules, 'plan.rules'),
    phases,
    blocks,
    templates,
    schedule: schedule ?? { kind: 'frequency', sessionsPerWeek: [3, 3], rotation: templates.map(t => t.id) },
    deloads: r
      .arr(o.deloads, 'plan.deloads', 52)
      .map((d, i) => r.date(d, `plan.deloads[${i}]`, true))
      .filter((d): d is string => Boolean(d))
      .sort(),
  };

  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, plan };
}

/**
 * Problems with phase targets that logged sessions can never check: no path, or
 * a path with neither a stage nor a dose. Such a target shows as unchecked and
 * never counts toward its phase, so a plan write must not add one. Targets that
 * already appear, unchanged, in `previous` are left alone: a stored plan that
 * has one stays loadable and editable in every other respect.
 *
 * Kept out of `validatePlan`, which also reads stored plans.
 */
export function uncheckableTargetProblems(plan: TrainingPlan, previous: TrainingPlan | null = null): string[] {
  const existing = new Set(previous?.phases.flatMap(p => p.targets.map(t => JSON.stringify(t))) ?? []);
  const problems: string[] = [];
  for (const phase of plan.phases) {
    for (const t of phase.targets) {
      if ((t.pathId && (t.stageId || t.dose)) || existing.has(JSON.stringify(t))) continue;
      const where = `Phase "${phase.name}" target "${t.label}"`;
      const path = t.pathId ? findPath(plan, t.pathId)?.path : undefined;
      problems.push(
        path
          ? `${where} cannot be checked against sessions: give it a stageId on path "${path.id}" (${path.stages.map(s => s.id).join(', ')}) with reach "started" or "mastered", or a dose. Put an aim no session can show in the phase's goals instead.`
          : `${where} cannot be checked against sessions: give it a pathId (${allPaths(plan).map(p => p.id).join(', ')}) and a stageId or dose. Put an aim no session can show in the phase's goals instead.`
      );
    }
  }
  return problems;
}

// ── Lookups shared by the engine, the tools and the UI ──

export function allPaths(plan: TrainingPlan): Path[] {
  return plan.focusAreas.flatMap(a => a.paths);
}

export function findPath(plan: TrainingPlan, pathId: string): { area: FocusArea; path: Path } | null {
  for (const area of plan.focusAreas) {
    const path = area.paths.find(p => p.id === pathId);
    if (path) return { area, path };
  }
  return null;
}

export function currentStage(path: Path): Stage {
  return path.stages.find(s => s.id === path.currentStageId) ?? path.stages[0];
}

export function nextStage(path: Path): Stage | null {
  const i = path.stages.findIndex(s => s.id === path.currentStageId);
  return i >= 0 && i + 1 < path.stages.length ? path.stages[i + 1] : null;
}
