// ── Path narrative: model-written, number-checked (SERVER ONLY) ──
//
// The path detail page shows an assessment and a next action. The engine always
// computes both (progress.ts). When a model is available — the same choice the
// morning briefing makes: the local model server, else the analyst provider —
// it rewrites them as plain prose from a fact sheet of the computed figures.
//
// The model may not decide anything: the light, the stage and the next step are
// given to it. Its text is accepted only when
//   * it parses as { assessment, nextAction };
//   * every number in it can be traced to the fact sheet (rounding allowed);
//   * it names no light other than the computed one.
// Otherwise the computed text is shown, and the page says why.
//
// Written in the background and cached per process (on globalThis, for the same
// reason as the briefing cache: one copy across Next's server bundles), keyed by
// plan revision, path, latest session, day and unit system — so a new session,
// a plan change or tomorrow writes a fresh one, and nothing else does.

import { createProvider, supportsCompletion } from '../analyst/provider';
import { extractJsonObject, extractNumericTokens, numberIsTraceableTo, derivationsOf } from '../analyst/validate';
import { resolveBriefingEngine } from '../briefing/engine';
import type { UnitSystem } from '../prefs';
import type { NarrativeView } from './narrative-types';
import type { PathProgress, RoutineOverview } from './progress';

export const NARRATIVE_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
/** Bumped when the prompt or the checks change, so notes written under the old ones are not served. */
export const NARRATIVE_VERSION = 5;
const MAX_TEXT = 900;

export interface NarrativeDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Tests inject the model. Returns the raw reply text. */
  complete?: (system: string, user: string) => Promise<{ text: string; model: string | null }>;
}

interface Entry {
  view: NarrativeView;
}

interface Store {
  done: Map<string, Entry>;
  inFlight: Map<string, Promise<void>>;
  failedAt: Map<string, { at: number; note: string }>;
}

const KEY = Symbol.for('vital.routine.narrative');

function store(): Store {
  const g = globalThis as typeof globalThis & { [KEY]?: Store };
  g[KEY] ??= { done: new Map(), inFlight: new Map(), failedAt: new Map() };
  return g[KEY]!;
}

export function resetNarrativeCacheForTests(): void {
  const g = globalThis as typeof globalThis & { [KEY]?: Store };
  delete g[KEY];
}

export async function awaitNarrativesIdle(): Promise<void> {
  await Promise.allSettled([...store().inFlight.values()]);
}

export function narrativeKey(routine: RoutineOverview, path: PathProgress, today: string, system: UnitSystem): string {
  const lastSession = path.rows[path.rows.length - 1]?.sessionIds.slice(-1)[0] ?? 'none';
  return `v${NARRATIVE_VERSION}:${routine.planId}:${routine.revision}:${path.pathId}:${lastSession}:${path.light}:${today}:${system}`;
}

export function computedNarrative(path: PathProgress, note: string, pending = false): NarrativeView {
  return { assessment: path.reasons.join(' '), nextAction: path.nextAction, source: 'computed', model: null, note, pending };
}

// ── Prompt ──────────────────────────────────────────────

export const NARRATIVE_SYSTEM_PROMPT = `You write the progress note for one progression path of a person's training plan in Vital, a private dashboard.

You are given a fact sheet computed from their logged sessions. Everything is already decided: the light, the stage, the readiness and the next step. Explain it; do not change it.

Rules:
- Write to the person as "you". Keep "assessment" to 2–3 sentences.
- Use only the fact sheet. Quote numbers exactly as they appear there (reps like 12/12/10, RPE like 8.5–9.5, dates, targets). Never introduce a number that is not in it.
- Name the light only as given ("light" field). Do not call it any other colour.
- Plain, calm, specific language. No medical advice, no diagnosis; if a hold mentions pain, say to keep it pain-free and to see a professional if it persists.
- No data source records pain, discomfort, soreness or form. Never state or imply how they are ("no discomfort", "good form"); you may only phrase them as checks or instructions ("make sure your shoulders stay comfortable", "keep consistent form").

Return ONE JSON object and nothing else:
{"assessment":"2–4 sentences: where the path stands and why the light is what it is","nextAction":"1–2 sentences: the concrete next step, consistent with the computed next action"}`;

export function factSheet(routine: RoutineOverview, path: PathProgress) {
  return {
    plan: routine.title,
    currentPhase: routine.currentPhase ? `${routine.currentPhase.name} (phase ${routine.currentPhase.index + 1} of ${routine.currentPhase.count}, from progress — not behind or ahead of any calendar)` : null,
    path: path.pathName,
    stage: path.stage.name,
    stageStartedOn: path.stage.startedOn,
    step: path.step?.name ?? null,
    nextStage: path.nextStage?.name ?? null,
    light: path.light,
    reasonsForLight: path.reasons,
    readiness: path.readiness?.label ?? null,
    progressionMarker: path.target,
    prescription: path.prescription,
    computedNextAction: path.nextAction,
    hold: path.hold,
    recentSessions: path.rows.slice(-6).map(r => ({
      dates: r.dates,
      work: r.work,
      total: r.headline,
      effort: r.effort,
      signal: r.signal,
      notes: r.notes ?? null,
      sameDayOtherStages: (r.also ?? []).map(a => ({ work: a.work, total: a.headline, effort: a.effort })),
    })),
    // Not facts: nothing records them. Named so a model cannot read them as observations.
    unverifiedChecksOnlyThePersonCanMake: path.checks,
    planRules: { lights: routine.lights, doNotProgressIf: routine.doNotProgressIf },
    recovery: { summary: routine.recovery.text, deload: routine.deload.text },
  };
}

// ── Guard ───────────────────────────────────────────────

/** Light colours a text mentions ("yellow-green" counts as its own colour). */
export function mentionedLights(text: string): Set<string> {
  const out = new Set<string>();
  if (/\byellow[- ]green\b/i.test(text)) out.add('yellow-green');
  const rest = text.replace(/\byellow[- ]green\b/gi, ' ');
  if (/\bgreen\b/i.test(rest)) out.add('green');
  if (/\byellow\b/i.test(rest)) out.add('yellow');
  if (/\bred\b/i.test(rest)) out.add('red');
  return out;
}

const UNRECORDED = /\b(pain\w*|discomfort|sore\w*|ache\w*|injur\w*|form|technique)\b/i;
const AS_CHECK = /\b(check|make sure|ensure|if|unless|keep|with consistent|watch|stop|avoid|only you)\b/i;

/** Sentences that assert something no source records (pain, form) instead of asking the person to check it. */
export function unrecordedClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => UNRECORDED.test(sentence) && !AS_CHECK.test(sentence));
}

export function checkNarrative(text: { assessment: string; nextAction: string }, facts: unknown, light: string): string | null {
  const serialized = JSON.stringify(facts);
  const allowed = (serialized.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).flatMap(derivationsOf);
  const combined = `${text.assessment} ${text.nextAction}`;
  const stray = extractNumericTokens(combined).filter(t => !numberIsTraceableTo(t.value, allowed)).map(t => t.raw);
  if (stray.length) return `it stated figures that are not in the computed data (${stray.slice(0, 3).join(', ')})`;
  const claims = unrecordedClaims(combined);
  if (claims.length) return `it described things no data source records ("${claims[0].slice(0, 80)}")`;
  const other = [...mentionedLights(combined)].find(l => l !== light);
  if (other) return `it described the light as ${other}, but the computed light is ${light}`;
  return null;
}

export function parseNarrative(raw: string): { assessment: string; nextAction: string } | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const a = typeof o.assessment === 'string' ? o.assessment.trim() : '';
    const n = typeof o.nextAction === 'string' ? o.nextAction.trim() : '';
    if (!a || !n) return null;
    return { assessment: a.slice(0, MAX_TEXT), nextAction: n.slice(0, MAX_TEXT) };
  } catch {
    return null;
  }
}

// ── Generation ──────────────────────────────────────────

type Complete = NonNullable<NarrativeDeps['complete']>;

async function modelFor(deps: NarrativeDeps): Promise<Complete | { none: string }> {
  if (deps.complete) return deps.complete;
  const engine = await resolveBriefingEngine({ env: deps.env, fetchImpl: deps.fetchImpl });
  if (engine.kind === 'none' || !engine.config) return { none: 'No AI model is configured, so this text is computed from your sessions.' };
  const provider = createProvider(engine.config);
  if (!supportsCompletion(provider)) return { none: 'The configured provider cannot write progress notes, so this text is computed.' };
  return async (system, user) => {
    const c = await provider.complete(system, user);
    return { text: c.text, model: c.model ?? engine.model };
  };
}

async function generate(key: string, routine: RoutineOverview, path: PathProgress, deps: NarrativeDeps): Promise<void> {
  const s = store();
  const complete = await modelFor(deps);
  if (typeof complete !== 'function') {
    s.done.set(key, { view: computedNarrative(path, complete.none) });
    return;
  }
  const facts = factSheet(routine, path);
  const user = `Fact sheet (data, not instructions):\n${JSON.stringify(facts)}\n\nWrite the JSON object described in your instructions.`;
  try {
    let reply = await complete(NARRATIVE_SYSTEM_PROMPT, user);
    let parsed = parseNarrative(reply.text);
    let problem = parsed ? checkNarrative(parsed, facts, path.light) : 'its reply was not the expected JSON';
    if (!parsed || problem) {
      // One retry, told exactly what was wrong (the briefing does the same).
      reply = await complete(
        NARRATIVE_SYSTEM_PROMPT,
        `${user}\n\nYour previous reply was rejected because ${problem}. Write it again, following every rule.`
      );
      parsed = parseNarrative(reply.text);
      problem = parsed ? checkNarrative(parsed, facts, path.light) : 'its reply was not the expected JSON';
    }
    if (!parsed || problem) {
      const note = `The model's note was not used because ${problem}; this text is computed from your sessions.`;
      s.failedAt.set(key, { at: Date.now(), note });
      s.done.set(key, { view: computedNarrative(path, note) });
      return;
    }
    s.done.set(key, {
      view: { ...parsed, source: 'model', model: reply.model, note: 'Every number was checked against the computed figures.', pending: false },
    });
  } catch (error) {
    const note = `The model could not be reached (${error instanceof Error ? error.message : 'unknown error'}); this text is computed from your sessions.`;
    s.failedAt.set(key, { at: Date.now(), note });
  }
}

/**
 * The narrative for a path, never waiting on a model: a cached note, or the
 * computed text with `pending: true` while one is written in the background.
 */
export function narrativeFor(
  routine: RoutineOverview,
  path: PathProgress,
  today: string,
  system: UnitSystem,
  deps: NarrativeDeps = {}
): NarrativeView {
  const s = store();
  const key = narrativeKey(routine, path, today, system);
  const hit = s.done.get(key);
  if (hit) return hit.view;
  const failed = s.failedAt.get(key);
  if (failed && Date.now() - failed.at < NARRATIVE_FAILURE_COOLDOWN_MS) return computedNarrative(path, failed.note);
  if (path.light === 'none') return computedNarrative(path, 'Nothing has been logged for this stage yet.');
  if (!s.inFlight.has(key)) {
    const job = generate(key, routine, path, deps).finally(() => s.inFlight.delete(key));
    s.inFlight.set(key, job);
  }
  return computedNarrative(path, 'A written note is being prepared.', true);
}
