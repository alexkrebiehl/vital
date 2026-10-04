// ── Who is asking (SERVER ONLY) ─────────────────────────
//
// `currentIdentity()` is the ONE way server code learns which person a request
// is for. Pages and route handlers resolve it and then do their work inside
// `runAsUser` (./scope); nothing else reads the cookie or the headers.
//
// How the person is chosen is an IDENTITY PROVIDER, picked by VITAL_AUTH:
//
//   profiles (the default) — a household switcher, NOT access control. The
//       `vital_profile` cookie names a declared profile; a missing or unknown
//       one means the primary profile. Anyone who can reach the app can pick
//       any profile.
//
// A provider only has to turn a request into a declared profile slug, so an
// external identity provider slots in here without touching any store:
//   * a trusted proxy header (forward-auth: Authentik, oauth2-proxy, …) mapping
//     a header value to a slug, with `canSwitch: false`;
//   * OIDC, mapping (issuer, subject) to `users.external_issuer/subject`, with
//     middleware that requires a session.
// Neither is built yet; VITAL_AUTH rejects any value but `profiles`.

import { cookies, headers } from 'next/headers';
import { resolveUserIds } from '@/lib/db/users-store';
import { declaredProfiles, findProfile, profileEnv, type DeclaredProfile } from './profiles';
import { fallbackIdentityForTests, runAsUser } from './scope';
import type { Identity } from './types';

export type { Identity, ProfileOption } from './types';
export { runAsUser, requireUserId, scopedIdentity } from './scope';
export { serverEnv } from './env';

/** The cookie the profile switcher sets. */
export const PROFILE_COOKIE = 'vital_profile';

export interface RequestCredentials {
  cookie(name: string): string | undefined;
  header(name: string): string | null;
}

export interface IdentityProvider {
  kind: string;
  /** Whether the reader may switch to another profile in the app. */
  canSwitch: boolean;
  /** The declared profile this request is for, or null for "the default". */
  resolveSlug(request: RequestCredentials, env: NodeJS.ProcessEnv): string | null;
}

const profilesProvider: IdentityProvider = {
  kind: 'profiles',
  canSwitch: true,
  resolveSlug(request, env) {
    return findProfile(request.cookie(PROFILE_COOKIE), env)?.slug ?? null;
  },
};

/** The identity provider VITAL_AUTH selects. */
export function identityProvider(env: NodeJS.ProcessEnv = process.env): IdentityProvider {
  const kind = (env.VITAL_AUTH ?? '').trim().toLowerCase() || 'profiles';
  if (kind === 'profiles') return profilesProvider;
  throw new Error(`VITAL_AUTH=${kind} is not supported; the only identity provider is "profiles".`);
}

/** Build the identity for one declared profile (used by requests and by background work). */
export async function identityFor(profile: DeclaredProfile, env: NodeJS.ProcessEnv = process.env): Promise<Identity> {
  let userId: string | null = null;
  let userError: string | null = null;
  try {
    userId = (await resolveUserIds(declaredProfiles(env), env)).get(profile.slug) ?? null;
    if (!userId) userError = `No database user exists for the profile "${profile.slug}".`;
  } catch (error) {
    userError = error instanceof Error ? error.message : 'The profile could not be resolved in the database.';
  }
  return { slug: profile.slug, primary: profile.primary, userId, userError, env: profileEnv(profile, env) };
}

/** The identity of every declared profile, primary first. */
export async function allIdentities(env: NodeJS.ProcessEnv = process.env): Promise<Identity[]> {
  return Promise.all(declaredProfiles(env).map(p => identityFor(p, env)));
}

/** Pick the declared profile a request is for. */
export function profileForRequest(request: RequestCredentials, env: NodeJS.ProcessEnv = process.env): DeclaredProfile {
  const slug = identityProvider(env).resolveSlug(request, env);
  const profiles = declaredProfiles(env);
  return profiles.find(p => p.slug === slug) ?? profiles[0];
}

/** Who the current request (server component or route handler) is for. */
export async function currentIdentity(env: NodeJS.ProcessEnv = process.env): Promise<Identity> {
  const fallback = fallbackIdentityForTests();
  if (fallback) return fallback;
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const profile = profileForRequest({ cookie: name => jar.get(name)?.value, header: name => head.get(name) }, env);
  return identityFor(profile, env);
}

/** Resolve the current request's identity and run `fn` as it. */
export async function withCurrentUser<T>(fn: (identity: Identity) => Promise<T> | T): Promise<T> {
  const identity = await currentIdentity();
  return runAsUser(identity, () => fn(identity));
}

/**
 * Wrap a route handler so its whole body (and anything it starts, such as a
 * streamed response's `start`) runs as the requesting profile:
 *
 *     async function handleGET(request: Request) { … }
 *     export const GET = scoped(handleGET);
 */
export function scoped<A extends unknown[], R>(handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => withCurrentUser(() => handler(...args));
}
