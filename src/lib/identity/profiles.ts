// ── Declared profiles ───────────────────────────────────
//
// The people one Vital deployment serves are DECLARED in the environment, the
// same place every credential lives:
//
//     VITAL_PROFILES=alex,sam
//
// Each slug is lowercase letters, digits and hyphens, starting with a letter.
// The first one is the PRIMARY profile. With VITAL_PROFILES unset there is one
// implicit profile, `owner`, and the deployment behaves exactly as a
// single-person Vital always has.
//
// Per-person variables
//   A handful of variables describe one person's data rather than the
//   deployment: their Health Auto Export server, their Hevy key, their data mode
//   and fallback timezone (PER_PROFILE_VARS). For a profile they are read from
//
//     VITAL_PROFILE_<SLUG>_<VAR>      e.g. VITAL_PROFILE_SAM_HAE_API_KEY
//
//   (the slug upper-cased, hyphens as underscores). Only the PRIMARY profile
//   falls back to the plain, unprefixed variable, so an existing deployment keeps
//   working when VITAL_PROFILES is introduced. Every other profile has those
//   variables BLANKED when its own are not set: a second person must never be
//   served the primary person's health export by accident.
//
// Everything else (database, analyst and briefing models, map tiles, geocoder)
// is shared by every profile and read unprefixed.

export const DEFAULT_PROFILE_SLUG = 'owner';

const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** The variables that belong to one person rather than to the deployment. */
export const PER_PROFILE_VARS = [
  'VITAL_DATA_MODE',
  'VITAL_TIMEZONE',
  'HAE_API_URL',
  'HAE_API_KEY',
  'HAE_PROBE_METRIC',
  'HAE_CACHE_TTL_SECONDS',
  'HEVY_API_KEY',
  'HEVY_API_URL',
  'HEVY_CACHE_TTL_SECONDS',
] as const;

export type PerProfileVar = (typeof PER_PROFILE_VARS)[number];

export function isPerProfileVar(name: string): name is PerProfileVar {
  return (PER_PROFILE_VARS as readonly string[]).includes(name);
}

export interface DeclaredProfile {
  slug: string;
  /** The first declared profile: it owns the unprefixed variables and any data
   *  stored before profiles existed. */
  primary: boolean;
}

export function isProfileSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

/** True when the deployment declares its profiles (VITAL_PROFILES is set). */
export function profilesDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VITAL_PROFILES ?? '').trim() !== '';
}

/**
 * The declared profiles, primary first. Invalid or repeated slugs are skipped
 * with a warning; a list with nothing valid in it falls back to the implicit
 * `owner` profile rather than serving nobody.
 */
export function declaredProfiles(env: NodeJS.ProcessEnv = process.env): DeclaredProfile[] {
  const raw = (env.VITAL_PROFILES ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const slugs: string[] = [];
  for (const slug of raw) {
    if (!isProfileSlug(slug)) {
      console.warn(`[vital] VITAL_PROFILES: "${slug}" is not a valid profile slug (a-z, 0-9, "-"; starts with a letter) and is ignored.`);
      continue;
    }
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  if (slugs.length === 0) slugs.push(DEFAULT_PROFILE_SLUG);
  return slugs.map((slug, i) => ({ slug, primary: i === 0 }));
}

/** The declared profile with this slug, or null. */
export function findProfile(slug: string | null | undefined, env: NodeJS.ProcessEnv = process.env): DeclaredProfile | null {
  if (!slug) return null;
  return declaredProfiles(env).find(p => p.slug === slug) ?? null;
}

/** The variable a profile's own value of `name` is read from. */
export function profileVarName(slug: string, name: PerProfileVar): string {
  return `VITAL_PROFILE_${slug.toUpperCase().replace(/-/g, '_')}_${name}`;
}

/**
 * The variable that actually configures `name` for this profile: its own
 * prefixed one when set, otherwise (primary only) the plain one. Used by the
 * status surfaces to name the variable a person should set.
 */
export function effectiveVarName(profile: DeclaredProfile, name: PerProfileVar, env: NodeJS.ProcessEnv = process.env): string {
  const own = profileVarName(profile.slug, name);
  if ((env[own] ?? '').trim() !== '') return own;
  if (profile.primary) return name;
  return own;
}

/**
 * The environment one profile's server reads see: the deployment's environment
 * with the per-person variables replaced by that profile's own values.
 */
export function profileEnv(profile: DeclaredProfile, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of PER_PROFILE_VARS) {
    const own = env[profileVarName(profile.slug, name)];
    if (own !== undefined && own.trim() !== '') out[name] = own;
    else if (!profile.primary) delete out[name];
  }
  return out;
}
