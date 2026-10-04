// ── Lab module configuration (SERVER ONLY) ───────────────────────────────────
//
// The three settings the lab module reads, and their documented defaults. No
// import here pulls in `fs` or `pg`, so the pure validation and the tests can
// use the same parsing without a filesystem.
//
//   Each profile stores its PDFs in its own directory (`profileLabDir`), which
//   the lab routes apply for the profile in scope.
//
//   VITAL_LAB_DIR         where uploaded PDFs are stored, content-addressed.
//                         Default /app/data/lab (./data is mounted writable).
//   VITAL_LAB_MAX_BYTES   largest accepted upload, default 15 MB.
//   VITAL_LAB_MODEL_ASSIST  `auto` (default), `on` or `off`. Controls the
//                         OPTIONAL second extraction pass. `off` guarantees no
//                         network call is made for an upload.


/** Where uploaded PDFs live when nothing overrides it. */
export const DEFAULT_LAB_DIR = '/app/data/lab';

/** Largest accepted upload when nothing overrides it: 15 MB. */
export const DEFAULT_LAB_MAX_BYTES = 15 * 1024 * 1024;

export type LabModelAssist = 'auto' | 'on' | 'off';

export interface LabConfig {
  /** Directory uploaded PDFs are stored in. */
  dir: string;
  /** Largest accepted upload, in bytes. */
  maxBytes: number;
  /** The configured model-assist mode. */
  modelAssist: LabModelAssist;
  /** Whether the optional model pass may run. `auto` and `on` allow it. */
  modelAssistEnabled: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMode(value: string | undefined): LabModelAssist {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'on' || v === 'off' || v === 'auto') return v;
  return 'auto';
}

/**
 * Where one profile's PDFs live: the primary profile keeps the configured
 * directory itself (where every PDF uploaded before profiles existed already
 * is), and any other profile gets its own `<dir>/<slug>` beside them, so
 * deleting one person's document can never remove another's copy of the file.
 */
export function profileLabDir(dir: string, profile: { slug: string; primary: boolean } | null): string {
  if (!profile || profile.primary) return dir;
  return `${dir.replace(/\/+$/, '')}/${profile.slug}`;
}

/** The lab module's configuration, from an injected or the process environment.
 *  `dir` is the configured directory; a route stores one person's PDFs in
 *  `profileLabDir(dir, …)`. (This module also reaches the browser bundle, so it
 *  cannot read the request scope itself.) */
export function resolveLabConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const dir = (env.VITAL_LAB_DIR ?? '').trim() || DEFAULT_LAB_DIR;
  const maxBytes = parsePositiveInt(env.VITAL_LAB_MAX_BYTES, DEFAULT_LAB_MAX_BYTES);
  const modelAssist = parseMode(env.VITAL_LAB_MODEL_ASSIST);
  return { dir, maxBytes, modelAssist, modelAssistEnabled: modelAssist !== 'off' };
}