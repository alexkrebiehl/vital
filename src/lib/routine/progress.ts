// ── Routine progress: the shared pipeline ───────────────
//
// `buildRoutine` turns a stored plan plus the reader's data into everything the
// Workouts page, the path detail page and the analyst's tools show:
//
//   for every path
//     1. collect the current stage's sessions (since it began) and the previous
//        stage's, from the workout sources and Apple Health workouts;
//     2. let the path's progression model judge them (models/);
//     3. apply what every model shares:
//          a hold      → red (regress) or at most yellow (hold), with its reason
//          recovery    → a `warn` gate caps the light at yellow, `watch` at yellow-green
//          deloads     → a deload block, or an overdue deload, replaces "move on" advice
//   for the plan
//     week and blocks, what session is next, adherence, deload timing, recovery.
//
// Pure: everything it reads is passed in, so it runs the same in tests, in the
// API routes and in the analyst's tools.

import type { WorkoutRecord } from '../metrics/types';
import type { UnitSystem } from '../prefs';
import type { TrainingSession } from '../workout-sources/types';
import { doseText } from './format';
import { MODEL_PARAM_SPECS } from './model-params';
import { PROGRESSION_MODELS, type Light, type ModelEvaluation, type ProgressRow, type Readiness } from './models';
import { LIGHT_ORDER } from './models/types';
import { currentBlocks, deloadStatus, planPosition, planWeek, type BlockView, type DeloadStatus } from './position';
import { recordsForStage, type PerformanceRecord } from './records';
import { recoveryIndicators, recoverySummary, type DayValue, type RecoveryIndicator } from './recovery';
import { adherence, completedSessions, nextSession, type Adherence, type NextSessionView } from './schedule';
import type { Path, PathHold, StoredPlan, TrainingPlan } from './types';

export interface StageView {
  id: string;
  name: string;
  index: number;
  status: 'done' | 'current' | 'upcoming';
  startedOn: string | null;
  expectedWeeks?: [number, number];
  target: string;
  steps: string[];
}

export interface PathProgress {
  areaId: string;
  areaName: string;
  pathId: string;
  pathName: string;
  model: string;
  modelLabel: string;
  priority: Path['priority'];
  stage: StageView;
  step: { index: number; name: string; count: number } | null;
  nextStage: { id: string; name: string } | null;
  stages: StageView[];
  light: Light;
  reasons: string[];
  readiness: Readiness | null;
  nextAction: string;
  target: string;
  prescription: string;
  cues: string[];
  checks: string[];
  hold: PathHold | null;
  rows: ProgressRow[];
  lastSession: { date: string; work: string } | null;
  facts: ModelEvaluation['facts'];
}

export interface RoutineOverview {
  planId: string;
  revision: number;
  title: string;
  goal: string;
  context: string[];
  startDate: string;
  durationWeeks: number;
  week: number;
  started: boolean;
  currentBlocks: string[];
  blocks: BlockView[];
  next: NextSessionView;
  adherence: Adherence;
  deload: DeloadStatus;
  recovery: { status: 'ok' | 'watch' | 'warn' | 'unknown'; text: string; indicators: RecoveryIndicator[] };
  lights: TrainingPlan['rules']['lights'];
  doNotProgressIf: string[];
  paths: PathProgress[];
}

export interface RoutineInputs {
  stored: StoredPlan;
  sessions: TrainingSession[];
  workouts: WorkoutRecord[];
  series: (metricId: string) => DayValue[];
  today: string;
  dayOf: (iso: string) => string;
  system: UnitSystem;
}

function capLight(light: Light, cap: Light): Light {
  if (light === 'none') return light;
  return LIGHT_ORDER.indexOf(light) > LIGHT_ORDER.indexOf(cap) ? cap : light;
}

function stageStart(path: Path, stageId: string): string | null {
  const entries = path.history.filter(h => h.stageId === stageId);
  return entries.length ? entries[entries.length - 1].startedOn : null;
}

/** Records of every stage of a path, keyed by stage id. */
function pathRecords(path: Path, inputs: RoutineInputs): Map<string, PerformanceRecord[]> {
  const out = new Map<string, PerformanceRecord[]>();
  for (const stage of path.stages) out.set(stage.id, recordsForStage(stage, inputs.sessions, inputs.workouts, { dayOf: inputs.dayOf }));
  return out;
}

export function evaluatePath(
  plan: TrainingPlan,
  areaId: string,
  areaName: string,
  path: Path,
  byStage: Map<string, PerformanceRecord[]>,
  recoveryCap: { cap: Light; reasons: string[] },
  deload: DeloadStatus,
  inputs: RoutineInputs
): PathProgress {
  const index = Math.max(0, path.stages.findIndex(s => s.id === path.currentStageId));
  const stage = path.stages[index];
  const previousStage = index > 0 ? path.stages[index - 1] : null;
  const nextStageDef = index + 1 < path.stages.length ? path.stages[index + 1] : null;
  const startedOn = stageStart(path, stage.id);
  const records = (byStage.get(stage.id) ?? []).filter(r => !startedOn || r.date >= startedOn);
  const previousRecords = previousStage
    ? (byStage.get(previousStage.id) ?? []).filter(r => !startedOn || r.date < startedOn)
    : [];
  const week = planWeek(plan, inputs.today);
  const blocks = currentBlocks(plan, week);

  const evaluation = PROGRESSION_MODELS[path.model].evaluate({
    path,
    stage,
    nextStage: nextStageDef,
    records,
    previousRecords,
    previousStage,
    rules: plan.rules,
    blocks,
    today: inputs.today,
    system: inputs.system,
  });

  let light = evaluation.light;
  const reasons = [...evaluation.reasons];
  let nextAction = evaluation.nextAction;

  if (path.hold) {
    light = path.hold.kind === 'regress' ? 'red' : capLight(light, 'yellow');
    reasons.unshift(`${path.hold.kind === 'regress' ? 'Regress' : 'On hold'} since ${path.hold.since}: ${path.hold.reason}`);
    nextAction =
      path.hold.kind === 'regress'
        ? `Step back to ${previousStage ? previousStage.name.toLowerCase() : 'an easier version'} or cut the volume until "${path.hold.reason}" has resolved.`
        : `Hold ${stage.name.toLowerCase()} at an easy, pain-free volume; do not progress until "${path.hold.reason}" has resolved.`;
  } else if (light !== 'none' && LIGHT_ORDER.indexOf(light) > LIGHT_ORDER.indexOf(recoveryCap.cap)) {
    light = recoveryCap.cap;
    reasons.push(...recoveryCap.reasons);
    if (evaluation.light === 'green') nextAction = `Performance says move on, but recovery does not: repeat ${doseText(evaluation.target, inputs.system)} until ${recoveryCap.reasons.join(' ').replace(/\.$/, '').toLowerCase()} settles.`;
  }
  const deloadNow = blocks.find(b => b.kind === 'deload');
  if (!path.hold && (deloadNow || deload.status === 'overdue') && evaluation.light === 'green') {
    nextAction = `${deloadNow ? deloadNow.name : 'Deload overdue'}: keep ${stage.name.toLowerCase()} and cut sets by a third to a half this week; progress after it.`;
  }

  const stages: StageView[] = path.stages.map((s, i) => ({
    id: s.id,
    name: s.name,
    index: i,
    status: i < index ? 'done' : i === index ? 'current' : 'upcoming',
    startedOn: stageStart(path, s.id),
    ...(s.expectedWeeks ? { expectedWeeks: s.expectedWeeks } : {}),
    target: doseText(s.advanceWhen ?? s.prescription, inputs.system),
    steps: (s.steps ?? []).map(x => x.name),
  }));
  const stepIndex = path.currentStepIndex;
  const lastRow = records.length ? evaluation.rows[evaluation.rows.length - 1] : null;

  return {
    areaId,
    areaName,
    pathId: path.id,
    pathName: path.name,
    model: path.model,
    modelLabel: MODEL_PARAM_SPECS[path.model].label,
    priority: path.priority,
    stage: stages[index],
    step: stepIndex !== undefined && stage.steps?.[stepIndex] ? { index: stepIndex, name: stage.steps[stepIndex].name, count: stage.steps.length } : null,
    nextStage: nextStageDef ? { id: nextStageDef.id, name: nextStageDef.name } : null,
    stages,
    light,
    reasons,
    readiness: evaluation.readiness,
    nextAction,
    target: doseText(evaluation.target, inputs.system),
    prescription: doseText(stage.prescription, inputs.system),
    cues: stage.cues,
    checks: stage.checks,
    hold: path.hold ?? null,
    rows: evaluation.rows,
    lastSession: lastRow ? { date: lastRow.dates[lastRow.dates.length - 1], work: lastRow.work } : null,
    facts: evaluation.facts,
  };
}

export function buildRoutine(inputs: RoutineInputs): RoutineOverview {
  const { stored, today, system } = inputs;
  const plan = stored.plan;
  const week = planWeek(plan, today);

  const completed = completedSessions(plan, inputs.sessions, inputs.workouts, inputs.dayOf);
  const trainingDays = [
    ...new Set([...inputs.sessions.map(s => inputs.dayOf(s.startTime)), ...completed.map(c => c.date)]),
  ];
  const indicators = recoveryIndicators({ series: inputs.series, trainingDays, today, system }, plan.rules.recoveryGates);
  const summary = recoverySummary(indicators);
  const warn = indicators.filter(i => i.status === 'warn');
  const watch = indicators.filter(i => i.status === 'watch');
  const recoveryCap = warn.length
    ? { cap: 'yellow' as Light, reasons: warn.map(i => `${i.label}: ${i.text}`) }
    : watch.length
      ? { cap: 'yellow-green' as Light, reasons: watch.map(i => `${i.label}: ${i.text}`) }
      : { cap: 'green' as Light, reasons: [] };
  const deload = deloadStatus(plan, today);

  const recordsByPath = new Map<string, PerformanceRecord[]>();
  const paths: PathProgress[] = [];
  for (const area of plan.focusAreas) {
    for (const path of area.paths) {
      const byStage = pathRecords(path, inputs);
      recordsByPath.set(path.id, [...byStage.values()].flat().sort((a, b) => a.startTime.localeCompare(b.startTime)));
      paths.push(evaluatePath(plan, area.id, area.name, path, byStage, recoveryCap, deload, inputs));
    }
  }

  return {
    planId: stored.id,
    revision: stored.revision,
    title: plan.title,
    goal: plan.goal,
    context: plan.context,
    startDate: plan.startDate,
    durationWeeks: plan.durationWeeks,
    week,
    started: today >= plan.startDate,
    currentBlocks: currentBlocks(plan, week).map(b => b.name),
    blocks: planPosition(plan, recordsByPath, today, system),
    next: nextSession(plan, completed, today, week, system),
    adherence: adherence(plan, completed, today, week),
    deload,
    recovery: { ...summary, indicators },
    lights: plan.rules.lights,
    doNotProgressIf: plan.rules.doNotProgressIf,
    paths,
  };
}

/**
 * Place each path on the stage the reader is actually training.
 *
 * For a plan created after training has already begun: the furthest stage with
 * a session in the last `recentDays` becomes current, and each stage that was
 * trained gets a history entry from its first session. Paths with no matching
 * sessions are left on their first stage.
 */
export function inferCurrentStages(
  plan: TrainingPlan,
  sessions: TrainingSession[],
  workouts: WorkoutRecord[],
  dayOf: (iso: string) => string,
  today: string,
  recentDays = 42
): { plan: TrainingPlan; changes: string[] } {
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - recentDays * 86_400_000).toISOString().slice(0, 10);
  const changes: string[] = [];
  const next: TrainingPlan = structuredClone(plan);
  for (const area of next.focusAreas) {
    for (const path of area.paths) {
      const firsts = path.stages.map(stage => {
        const recs = recordsForStage(stage, sessions, workouts, { dayOf });
        return { stage, first: recs[0]?.date ?? null, recent: recs.some(r => r.date >= cutoff) };
      });
      let current = -1;
      firsts.forEach((f, i) => {
        if (f.recent) current = i;
      });
      if (current < 0) continue;
      path.currentStageId = firsts[current].stage.id;
      path.currentStepIndex = undefined;
      path.history = firsts
        .slice(0, current + 1)
        .filter(f => f.first)
        .map(f => ({ stageId: f.stage.id, startedOn: f.first!, reason: 'Inferred from logged sessions' }));
      changes.push(`${path.name}: ${firsts[current].stage.name} (since ${firsts[current].first})`);
    }
  }
  return { plan: next, changes };
}
