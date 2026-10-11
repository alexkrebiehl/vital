// ── Lab module configuration (SERVER ONLY) ───────────────────────────────────
//
// The two settings the lab module reads, and their documented defaults. No
// import here pulls in `fs` or `pg`, so the pure validation and the tests can
// use the same parsing without a filesystem.
//
//   VITAL_LAB_DIR         where uploaded PDFs are stored, content-addressed.
//                         Default /app/data/lab (./data is mounted writable).
//   VITAL_LAB_MAX_BYTES   largest accepted upload, default 15 MB.
//
// The OPTIONAL model second pass is switched in Settings (Preferences → AI
// models → Analyst), not here: VITAL_LAB_MODEL_ASSIST is no longer read.

/** Where uploaded PDFs live when nothing overrides it. */
export const DEFAULT_LAB_DIR = '/app/data/lab';

/** Largest accepted upload when nothing overrides it: 15 MB. */
export const DEFAULT_LAB_MAX_BYTES = 15 * 1024 * 1024;

export interface LabConfig {
  /** Directory uploaded PDFs are stored in. */
  dir: string;
  /** Largest accepted upload, in bytes. */
  maxBytes: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The lab module's configuration, from an injected or the process environment. */
export function resolveLabConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const dir = (env.VITAL_LAB_DIR ?? '').trim() || DEFAULT_LAB_DIR;
  const maxBytes = parsePositiveInt(env.VITAL_LAB_MAX_BYTES, DEFAULT_LAB_MAX_BYTES);
  return { dir, maxBytes };
}