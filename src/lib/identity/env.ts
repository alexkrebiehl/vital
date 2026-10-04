// ── The environment a server read sees ──────────────────
//
// Most of Vital's configuration is shared by every profile (the database, the
// analyst model, map tiles), but a few variables belong to a PERSON: where their
// health export lives, their Hevy key, their data mode (see ./profiles). Inside a
// request scope (./scope) those are overlaid for the profile being served, so a
// reader that asks `serverEnv()` gets that person's values and everything shared
// unchanged. Outside a scope it is simply `process.env`.
//
// This module has no Node imports on purpose: it is safe to import from code
// that also reaches the browser bundle, where it always answers `process.env`.

let envResolver: (() => NodeJS.ProcessEnv | undefined) | null = null;

/** Register where the current scope's environment comes from (server only). */
export function setEnvResolver(resolver: (() => NodeJS.ProcessEnv | undefined) | null): void {
  envResolver = resolver;
}

/** The current profile's environment, or `process.env` outside a request scope. */
export function serverEnv(): NodeJS.ProcessEnv {
  return envResolver?.() ?? process.env;
}
