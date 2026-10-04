// ── Briefing scheduler (server-only) ────────────────────
//
// Writes each day's briefing AT the profile's configured hour, instead of
// waiting for the first visit afterwards.
//
// Why it has to be armed from here rather than from `instrumentation.ts`: that
// hook runs in its own module graph, so a briefing written there is not the one
// the routes read (see the note in ./index). This module is imported by the
// Overview route, which is the bundle that actually answers requests, so the
// timer is armed by the first request that reaches `/`. It is deliberately NOT
// armed by the container healthcheck: that probes /api/health, which touches no
// briefing at all (see src/app/api/health/route.ts).
//
// Honest limits, stated rather than hidden:
//   * the process must be running at the hour, and the Overview route must have
//     been reached at least once before it, for the timer to be armed. If the
//     container was down at 08:00, nothing is written then; the first request
//     after it comes back writes that day's briefing once (a catch-up attempt),
//     and the hero labels the late write.
//   * there is one timer per declared profile per process, each firing inside
//     that profile's scope (its own profile row, dataset and cache key). The
//     first request arms every profile, not only the one it was for, so a
//     person nobody has visited since the restart still gets their briefing.
//   * with more than one replica, each would arm
//     its own; the day-keyed cache, the day-terminal attempt record and the
//     Postgres row make the write idempotent, so the worst case is a duplicate
//     attempt, not a duplicate briefing.
//
// A profile change (hour, timezone) is picked up on the next firing: the profile
// is re-read before each write, so the schedule follows the setting.

import { readProfile } from '../profile/store';
import type { VitalProfile } from '../profile/types';
import { warmBriefing } from './index';
import { readPreferences } from '../prefs/store';
import type { UnitSystem } from '../prefs/types';
import { nextBriefingAt } from './schedule';
import { installDataset } from '../adapters/runtime';
import { allIdentities } from '../identity';
import { runAsUser, scopedIdentity } from '../identity/scope';
import type { Identity } from '../identity/types';

/** setTimeout is fine for a day; this is the Node maximum, used as a guard. */
const MAX_DELAY_MS = 2_147_483_647;

interface Armed {
  timer: NodeJS.Timeout;
  /** The instant this timer is aiming at, so a re-arm only happens when it moves. */
  targetAt: number;
}

interface SchedulerState {
  /** One timer per profile slug. */
  armed: Map<string, Armed>;
  lastRunAt: Map<string, string>;
  /** Set once every declared profile has been armed in this process. */
  allArmed: Promise<void> | null;
}

const SCHEDULER_KEY = Symbol.for('vital.briefing.scheduler');

function schedulerState(): SchedulerState {
  const g = globalThis as typeof globalThis & { [SCHEDULER_KEY]?: SchedulerState };
  if (!g[SCHEDULER_KEY]) g[SCHEDULER_KEY] = { armed: new Map(), lastRunAt: new Map(), allArmed: null };
  return g[SCHEDULER_KEY];
}

function log(message: string): void {
  console.log(`[vital-briefing] ${message}`);
}

/** Test seam: forget every timer and last-run stamp. */
export function resetBriefingSchedulerForTests(): void {
  const state = schedulerState();
  for (const armed of state.armed.values()) clearTimeout(armed.timer);
  state.armed.clear();
  state.lastRunAt.clear();
  state.allArmed = null;
}

/** What the current profile's scheduler is aiming at, for the pipeline/report surfaces. */
export function briefingSchedulerState(): { armed: boolean; targetAt: number | null; lastRunAt: string | null } {
  const slug = scopedIdentity()?.slug ?? '-';
  const state = schedulerState();
  const armed = state.armed.get(slug);
  return { armed: armed !== undefined, targetAt: armed?.targetAt ?? null, lastRunAt: state.lastRunAt.get(slug) ?? null };
}

/**
 * The unit system the stored preferences say the reader uses.
 *
 * Defaults to `metric` when the preferences cannot be read: the briefing must
 * still be written on time, and a wrong system is a lazy re-fill at worst.
 */
async function readUnitSystem(): Promise<UnitSystem> {
  try {
    const prefs = await readPreferences();
    return prefs.units === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

/** One profile's scheduled write. Runs inside that profile's scope. */
async function fire(identity: Identity): Promise<void> {
  const state = schedulerState();
  state.armed.delete(identity.slug);
  state.lastRunAt.set(identity.slug, new Date().toISOString());
  const who = profileLabel(identity);
  let profile: VitalProfile;
  try {
    // Re-read: the hour or the timezone may have changed since this was armed.
    profile = await readProfile();
  } catch (error) {
    log(`${who}could not read the profile, so this run is skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
  }

  // The briefing cache key includes the unit system, so warming "metric" for
  // someone who reads in imperial wrote two briefings a day: the scheduled one
  // they never saw, and a lazy one on their first visit (observed: the hero
  // showed a 10:39 write while the scheduled 08:00 one sat in the other key).
  // Write the system the reader actually uses.
  const system = await readUnitSystem();

  try {
    // Nobody is visiting: install this profile's own dataset before writing.
    await installDataset();
    const outcome = await warmBriefing({ profile, system });
    log(
      outcome.ok
        ? `${who}wrote the briefing at the configured hour (${system}${outcome.engine ? `, ${outcome.engine}` : ''}${outcome.model ? `, ${outcome.model}` : ''}).`
        : `${who}could not write the briefing at the configured hour: ${outcome.reason ?? 'unknown reason'}. ` +
          'The day is terminal: it is not attempted again, and the hero reports the computed briefing and the reason.'
    );
  } catch (error) {
    // A generation failure must never take the process down or stop the schedule:
    // the next day's run still has to be armed.
    log(`${who}the scheduled write failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  // Arm the next day using the profile as it is now.
  try {
    arm(identity, await readProfile());
  } catch {
    // If the profile cannot be read, keep going with the one we have.
    arm(identity, profile);
  }
}

/** A log prefix naming the profile, empty for a single-profile deployment. */
function profileLabel(identity: Identity): string {
  return identity.primary && identity.slug === 'owner' ? '' : `[${identity.slug}] `;
}

function arm(identity: Identity, profile: VitalProfile): void {
  const state = schedulerState();
  const targetAt = nextBriefingAt(profile);
  if (!Number.isFinite(targetAt)) return;
  const current = state.armed.get(identity.slug);
  if (current && current.targetAt === targetAt) return; // already aiming there
  if (current) clearTimeout(current.timer);
  const delay = Math.min(Math.max(targetAt - Date.now(), 0), MAX_DELAY_MS);
  const timer = setTimeout(() => {
    void runAsUser(identity, () => fire(identity));
  }, delay);
  // The timer must not hold the process open on its own.
  if (typeof timer.unref === 'function') timer.unref();
  state.armed.set(identity.slug, { timer, targetAt });
  log(
    `${profileLabel(identity)}next briefing scheduled for ${new Date(targetAt).toISOString()} ` +
      `(${profile.timezone}, hour ${profile.briefingHour}), in ${Math.round(delay / 60000)} min.`
  );
}

/** Arm every declared profile once per process, each with its own profile. */
function armEveryProfile(): Promise<void> {
  const state = schedulerState();
  state.allArmed ??= (async () => {
    for (const identity of await allIdentities()) {
      if (!identity.userId) continue; // the database is unreachable; a later request retries
      await runAsUser(identity, async () => {
        try {
          arm(identity, await readProfile());
        } catch (error) {
          log(`${profileLabel(identity)}could not arm the scheduler: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      });
    }
  })().catch(error => {
    state.allArmed = null;
    log(`could not arm the schedulers: ${error instanceof Error ? error.message : 'unknown error'}`);
  });
  return state.allArmed;
}

/**
 * Make sure a timer is aiming at the next configured hour for the profile in
 * scope, and (once per process) for every other declared profile. Cheap and
 * idempotent: call it from a request path on every render.
 */
export function ensureBriefingScheduler(profile: VitalProfile): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const identity = scopedIdentity();
    if (identity) arm(identity, profile);
    void armEveryProfile();
  } catch (error) {
    // Scheduling is a background convenience: never fail a page render for it.
    log(`could not arm the scheduler: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
