// ── Plan actions shared by the API and the analyst tools (SERVER ONLY) ──
//
// Every write to the plans goes through here, so the Workouts page's buttons and
// the analyst's tools produce the same kind of `PlanChange` — which is what makes
// every change undoable from wherever it was made.

import { REFERENCE_PLANS, referencePlan } from './templates';
import { inferCurrentStages } from './progress';
import { loadRoutineContext, type RoutineDeps } from './service';
import { planRepository, type ChangeMeta } from './store';
import { workoutList } from '../adapters/dataset';
import { allPaths, validatePlan } from './validate';
import type { PlanChange, StoredPlan, TrainingPlan } from './types';

export class PlanInputError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'PlanInputError';
  }
}

/** Lines describing how `after` differs from `before` (paths, stages, schedule). */
export function describePlanDiff(before: TrainingPlan | null, after: TrainingPlan): string[] {
  if (!before) {
    const paths = allPaths(after);
    return [
      `${after.focusAreas.length} focus area${after.focusAreas.length === 1 ? '' : 's'}, ${paths.length} path${paths.length === 1 ? '' : 's'}, ${after.durationWeeks} weeks from ${after.startDate}`,
      ...paths.map(p => `${p.name}: starts at ${p.stages.find(s => s.id === p.currentStageId)?.name ?? p.stages[0].name}`),
    ];
  }
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: "${before.title}" → "${after.title}"`);
  if (before.goal !== after.goal) out.push('Goal updated');
  if (before.startDate !== after.startDate || before.durationWeeks !== after.durationWeeks) {
    out.push(`Dates: ${before.startDate}, ${before.durationWeeks} weeks → ${after.startDate}, ${after.durationWeeks} weeks`);
  }
  const bPaths = new Map(allPaths(before).map(p => [p.id, p]));
  const aPaths = new Map(allPaths(after).map(p => [p.id, p]));
  for (const [id, p] of aPaths) {
    const old = bPaths.get(id);
    if (!old) {
      out.push(`Added path ${p.name}`);
      continue;
    }
    const stageName = (x: typeof p) => x.stages.find(s => s.id === x.currentStageId)?.name ?? x.currentStageId;
    if (old.currentStageId !== p.currentStageId) out.push(`${p.name}: ${stageName(old)} → ${stageName(p)}`);
    if ((old.currentStepIndex ?? -1) !== (p.currentStepIndex ?? -1)) out.push(`${p.name}: step changed`);
    if (!old.hold && p.hold) out.push(`${p.name}: ${p.hold.kind === 'regress' ? 'regress' : 'on hold'} (${p.hold.reason})`);
    if (old.hold && !p.hold) out.push(`${p.name}: hold cleared`);
    if (JSON.stringify(old.stages) !== JSON.stringify(p.stages)) out.push(`${p.name}: stages edited`);
    if (old.model !== p.model || JSON.stringify(old.params ?? {}) !== JSON.stringify(p.params ?? {})) out.push(`${p.name}: progression model settings changed`);
  }
  for (const [id, p] of bPaths) if (!aPaths.has(id)) out.push(`Removed path ${p.name}`);
  if (JSON.stringify(before.schedule) !== JSON.stringify(after.schedule)) out.push('Schedule changed');
  if (JSON.stringify(before.templates) !== JSON.stringify(after.templates)) out.push('Session templates changed');
  if (JSON.stringify(before.phases) !== JSON.stringify(after.phases)) out.push('Phases changed');
  if (JSON.stringify(before.blocks) !== JSON.stringify(after.blocks)) out.push('Calendar blocks changed');
  if (JSON.stringify(before.rules) !== JSON.stringify(after.rules)) out.push('Progression rules changed');
  if (before.deloads.length !== after.deloads.length) out.push(`Deload recorded (${after.deloads[after.deloads.length - 1]})`);
  return out.length ? out : ['No visible change'];
}

export interface CreateOptions {
  /** Place each path on the stage the reader is already training. */
  inferStages?: boolean;
  meta: ChangeMeta;
}

/** Validate and store a new active plan (archiving the current one). */
export async function createPlan(input: unknown, options: CreateOptions, deps: RoutineDeps = {}): Promise<{ stored: StoredPlan; change: PlanChange; inferred: string[] }> {
  const v = validatePlan(input);
  if (!v.ok) throw new PlanInputError(v.errors);
  let plan = v.plan;
  let inferred: string[] = [];
  const ctx = await loadRoutineContext(deps);
  if (options.inferStages) {
    const result = inferCurrentStages(plan, ctx.training.sessions, workoutList(), ctx.dayOf, ctx.today);
    plan = result.plan;
    inferred = result.changes;
  }
  const repo = deps.repo ?? planRepository(deps.env ?? process.env);
  const previous = ctx.stored;
  const stored = await repo.create(plan, options.meta);
  return {
    stored,
    inferred,
    change: {
      kind: 'create',
      planId: stored.id,
      planTitle: stored.plan.title,
      fromRevision: null,
      toRevision: stored.revision,
      previousActivePlanId: previous?.id ?? null,
      summary: options.meta.summary,
      diff: describePlanDiff(null, stored.plan),
    },
  };
}

/** Validate and store a changed version of the active plan. */
export async function updateActivePlan(
  mutate: (plan: TrainingPlan) => unknown,
  meta: ChangeMeta,
  deps: RoutineDeps = {},
  expectedRevision?: number
): Promise<{ stored: StoredPlan; change: PlanChange }> {
  const repo = deps.repo ?? planRepository(deps.env ?? process.env);
  const current = await repo.active();
  if (!current) throw new PlanInputError(['There is no active plan to change. Create one first.']);
  const next = mutate(structuredClone(current.plan));
  const v = validatePlan(next);
  if (!v.ok) throw new PlanInputError(v.errors);
  const stored = await repo.update(current.id, v.plan, expectedRevision ?? current.revision, meta);
  return {
    stored,
    change: {
      kind: 'update',
      planId: stored.id,
      planTitle: stored.plan.title,
      fromRevision: current.revision,
      toRevision: stored.revision,
      previousActivePlanId: null,
      summary: meta.summary,
      diff: describePlanDiff(current.plan, v.plan),
    },
  };
}

export async function archiveActivePlan(meta: ChangeMeta, deps: RoutineDeps = {}): Promise<PlanChange> {
  const repo = deps.repo ?? planRepository(deps.env ?? process.env);
  const current = await repo.active();
  if (!current) throw new PlanInputError(['There is no active plan to archive.']);
  await repo.setStatus(current.id, 'archived');
  return {
    kind: 'archive',
    planId: current.id,
    planTitle: current.plan.title,
    fromRevision: current.revision,
    toRevision: current.revision,
    previousActivePlanId: null,
    summary: meta.summary,
    diff: [`Archived "${current.plan.title}"`],
  };
}

/**
 * Start from one of the reference plans. With `inferStages`, the plan's start
 * date moves back to the first session it recognises (so the week and blocks
 * reflect training already done) and each path starts on its current stage.
 */
export async function startFromReference(
  referenceId: string,
  meta: ChangeMeta,
  deps: RoutineDeps = {}
): Promise<{ stored: StoredPlan; change: PlanChange; inferred: string[] }> {
  const ref = REFERENCE_PLANS.find(r => r.id === referenceId);
  if (!ref) throw new PlanInputError([`No reference plan "${referenceId}" (known: ${REFERENCE_PLANS.map(r => r.id).join(', ')}).`]);
  const ctx = await loadRoutineContext(deps);
  const draft = referencePlan(ref.id, ctx.today);
  if (!draft.ok) throw new PlanInputError(draft.errors);
  const { plan: inferredPlan, changes } = inferCurrentStages(draft.plan, ctx.training.sessions, workoutList(), ctx.dayOf, ctx.today);
  const firstDate = allPaths(inferredPlan)
    .flatMap(p => p.history.map(h => h.startedOn))
    .sort()[0];
  const plan = firstDate && firstDate < ctx.today ? { ...inferredPlan, startDate: firstDate } : inferredPlan;
  return createPlan(plan, { meta }, deps).then(r => ({ ...r, inferred: changes }));
}
