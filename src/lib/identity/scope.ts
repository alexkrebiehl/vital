// ── Request scope (SERVER ONLY) ─────────────────────────
//
// One server process answers for every declared profile. Anything that belongs
// to a person (their dataset, their per-person environment, their database
// rows) is therefore read from the REQUEST SCOPE, never from module state:
//
//     await runAsUser(identity, async () => { …everything this request does… });
//
// Inside the scope:
//   * `@/lib/adapters/dataset` reads and installs this request's own dataset;
//   * `serverEnv()` (./env) answers with this profile's environment overlay;
//   * `requireUserId()` names the database user every store filters on.
//
// Outside a scope a store refuses to run rather than guess whose rows to touch.
//
// The AsyncLocalStorage lives on `globalThis`: Next builds the server into
// several bundles, each with its own copy of this module, and a scope entered in
// one must be visible to the copy of the dataset module in another.

import { AsyncLocalStorage } from 'node:async_hooks';
import { setDatasetScopeResolver, type DatasetScope } from '@/lib/adapters/dataset';
import { setEnvResolver } from './env';
import { effectiveVarName, isPerProfileVar, profilesDeclared } from './profiles';
import type { Identity } from './types';

export interface RequestScope {
  identity: Identity;
  dataset: DatasetScope;
}

const STORAGE_KEY = Symbol.for('vital.identity.scope');

interface ScopeGlobals {
  als: AsyncLocalStorage<RequestScope>;
  /** Tests only: the identity used when no scope is active. */
  fallback: Identity | null;
}

function globals(): ScopeGlobals {
  const g = globalThis as typeof globalThis & { [STORAGE_KEY]?: ScopeGlobals };
  if (!g[STORAGE_KEY]) g[STORAGE_KEY] = { als: new AsyncLocalStorage<RequestScope>(), fallback: null };
  return g[STORAGE_KEY];
}

setDatasetScopeResolver(() => globals().als.getStore()?.dataset);
setEnvResolver(() => globals().als.getStore()?.identity.env);

/** Run `fn` as `identity`, with a dataset slot of its own. */
export function runAsUser<T>(identity: Identity, fn: () => T): T {
  return globals().als.run({ identity, dataset: { state: null } }, fn);
}

/** The active scope, or undefined outside one. */
export function currentScope(): RequestScope | undefined {
  return globals().als.getStore();
}

/** The identity being served, or null outside a scope. */
export function scopedIdentity(): Identity | null {
  return globals().als.getStore()?.identity ?? globals().fallback;
}

/**
 * A key segment naming whose data a process-wide cache entry holds: the profile
 * slug in scope, or `-` outside one (tests, single-profile tooling).
 */
export function cacheOwner(): string {
  return scopedIdentity()?.slug ?? '-';
}

/**
 * The database id of the person being served. Throws outside a scope, and when
 * the user row could not be resolved (the database is down): a store must never
 * fall back to someone else's rows.
 */
export function requireUserId(): string {
  const identity = scopedIdentity();
  if (!identity) {
    throw new Error('No profile is in scope: per-person data can only be read inside runAsUser().');
  }
  if (!identity.userId) {
    throw new Error(identity.userError ?? `The profile "${identity.slug}" has no database user.`);
  }
  return identity.userId;
}

/**
 * Test seam: the identity used when no scope is active, and the one a request
 * resolves to. Never set in production.
 */
export function setFallbackIdentityForTests(identity: Identity | null): void {
  globals().fallback = identity;
}

export function fallbackIdentityForTests(): Identity | null {
  return globals().fallback;
}

/**
 * The variable that configures `name` for the profile in scope, for messages
 * that tell a person what to set: `HAE_API_KEY` in a single-profile deployment,
 * `VITAL_PROFILE_SAM_HAE_API_KEY` for the profile `sam`. Shared variables are
 * returned unchanged.
 */
export function configVarName(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const identity = scopedIdentity();
  if (!identity || !profilesDeclared(env) || !isPerProfileVar(name)) return name;
  return effectiveVarName(identity, name, env);
}
