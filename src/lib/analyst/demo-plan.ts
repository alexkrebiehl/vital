// ── Demo analyst: training-plan requests (SERVER ONLY) ──
//
// With no model configured, the demo analyst still handles the routine, by
// pattern — not language understanding — and through the same plan actions and
// PlanChange as the model's tools, so the whole flow (create, review, pause,
// undo) works offline:
//
//   "create / build / make … plan|program|routine"  → start from the closest
//                                                      reference plan (keywords)
//   "sore / pain / discomfort … <path or exercise>" → put that path on hold
//   "how is my routine|plan|progress|<path> going"  → summarise the routine
//
// Anything else is left to the regular demo handlers.

import type { UnitSystem } from '../prefs';
import { startFromReference, updateActivePlan, PlanInputError } from '../routine/actions';
import { loadRoutineContext, routineFor, type RoutineDeps } from '../routine/service';
import { REFERENCE_PLANS } from '../routine/templates';
import { findPath } from '../routine/validate';
import type { PlanChange } from '../routine/types';
import { BOUNDARY_NOTE } from './handlers';
import type { AnalystAnswer } from './types';

export const PLAN_PROMPTS = ['Create a 6-month calisthenics plan', 'How is my routine going?'];

export interface DemoPlanResult {
  handlerId: string;
  answer: AnalystAnswer;
  planChange: PlanChange | null;
}

function answer(id: string, title: string, observed: string[], interpretation: string[], uncertainty: string[], followUps: string[]): AnalystAnswer {
  return { id, title, observed, interpretation, uncertainty, evidence: [], charts: [], followUps, boundaryNote: BOUNDARY_NOTE };
}

const CREATE_RE = /\b(create|build|make|design|generate|start|write|set up)\b.*\b(plan|program|programme|routine|block)\b/;
const PAIN_RE = /\b(sore|soreness|pain|painful|hurts?|hurting|discomfort|ache|aching|tweak(ed)?|injur(y|ed))\b/;
const STATUS_RE = /\b(routine|plan|program|progress|progression)\b/;

export async function demoPlanAnswer(question: string, system: UnitSystem, deps: RoutineDeps = {}): Promise<DemoPlanResult | null> {
  const q = question.toLowerCase();
  // Everything else belongs to the regular demo handlers; nothing is loaded for it.
  if (!CREATE_RE.test(q) && !PAIN_RE.test(q) && !STATUS_RE.test(q)) return null;

  if (CREATE_RE.test(q)) {
    const ref = REFERENCE_PLANS.find(r => r.keywords.test(q));
    if (!ref) {
      return {
        handlerId: 'plan-create',
        planChange: null,
        answer: answer(
          'plan-create',
          'Which kind of plan?',
          [`The demo analyst builds plans from examples: ${REFERENCE_PLANS.map(r => r.label.toLowerCase()).join(', ')}.`],
          ['Name one of them in the request (for example "Create a calisthenics plan"). A configured AI provider can build a plan for any goal and schedule.'],
          ['The demo analyst matches words, not meaning, so it cannot tailor a plan to your goal.'],
          REFERENCE_PLANS.map(r => `Create a ${r.label.toLowerCase()} plan`).slice(0, 3)
        ),
      };
    }
    const result = await startFromReference(ref.id, { source: 'analyst', summary: `Created from the ${ref.label} example` }, deps);
    const weeks = result.stored.plan.durationWeeks;
    const asked = /(\d+)\s*-?\s*(month|week)/.exec(q);
    return {
      handlerId: 'plan-create',
      planChange: result.change,
      answer: answer(
        'plan-create',
        `Created: ${result.stored.plan.title}`,
        [
          `A ${weeks}-week plan with ${result.change.diff[0]}.`,
          ...(result.inferred.length ? [`Paths were placed on the stages your logged sessions show: ${result.inferred.join('; ')}.`] : ['No matching sessions were found, so every path starts at its first stage.']),
        ],
        ['The Routine section on the Workouts page now tracks each path against your sessions.'],
        [
          `This is the ${ref.label.toLowerCase()} example, not a plan tailored to you${asked ? ` (you asked for ${asked[1]} ${asked[2]}s; the example runs ${weeks} weeks)` : ''}. A configured AI provider can adjust it, or build one from scratch.`,
        ],
        ['How is my routine going?']
      ),
    };
  }

  const ctx = await loadRoutineContext(deps);
  if (!ctx.stored) {
    if (STATUS_RE.test(q)) {
      return {
        handlerId: 'plan-status',
        planChange: null,
        answer: answer('plan-status', 'No training plan yet', ['There is no active training plan.'], ['Ask for one, for example "Create a 6-month calisthenics plan".'], ['Without a plan there is nothing to track progress against.'], ['Create a 6-month calisthenics plan']),
      };
    }
    return null;
  }
  const routine = routineFor(ctx, ctx.stored, system);

  if (PAIN_RE.test(q)) {
    // Loose word stems, so "crunches" finds "Reverse Crunch".
    const stems = (text: string) =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(w => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)).filter(w => w.length > 2);
    const words = new Set(stems(q));
    const hit = routine.paths.find(p =>
      [p.pathName, p.stage.name, ...ctx.stored!.plan.focusAreas.find(a => a.id === p.areaId)!.paths.find(x => x.id === p.pathId)!.stages.flatMap(s => s.match.names)]
        .map(stems)
        .some(n => n.length > 0 && n.every(w => words.has(w)))
    );
    if (hit) {
      try {
        const { change } = await updateActivePlan(
          plan => {
            const found = findPath(plan, hit.pathId)!;
            found.path.hold = { kind: 'hold', reason: question.slice(0, 160), since: ctx.today };
            return plan;
          },
          { source: 'analyst', summary: `Paused ${hit.pathName}: reported discomfort` },
          deps
        );
        return {
          handlerId: 'plan-hold',
          planChange: change,
          answer: answer(
            'plan-hold',
            `${hit.pathName} is on hold`,
            [`${hit.pathName} (currently ${hit.stage.name.toLowerCase()}) is now on hold from ${ctx.today}.`],
            ['The routine will not suggest progressing this path until the hold is cleared; keep it easy and pain-free, or skip it.'],
            ['Only you can judge pain — no data source records it. Persistent or sharp pain is worth raising with a professional.'],
            ['How is my routine going?']
          ),
        };
      } catch (error) {
        if (!(error instanceof PlanInputError)) throw error;
      }
    }
  }

  if (STATUS_RE.test(q) || routine.paths.some(p => q.includes(p.pathName.toLowerCase()))) {
    const focus = routine.paths.filter(p => q.includes(p.pathName.toLowerCase()));
    const paths = focus.length ? focus : routine.paths;
    return {
      handlerId: 'plan-status',
      planChange: null,
      answer: answer(
        'plan-status',
        `${routine.title}: week ${routine.week} of ${routine.durationWeeks}`,
        paths.map(p => `${p.pathName}: ${p.stage.name.toLowerCase()} — ${p.light}${p.lastSession ? `; last ${p.lastSession.work} on ${p.lastSession.date}` : ''}${p.readiness ? ` (${p.readiness.label})` : ''}.`),
        paths.map(p => `${p.pathName}: ${p.nextAction}`),
        [routine.recovery.text, routine.deload.text, routine.adherence.text],
        ['Create a 6-month calisthenics plan']
      ),
    };
  }
  return null;
}
