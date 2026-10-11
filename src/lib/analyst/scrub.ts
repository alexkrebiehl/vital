// ── Analyst error scrubbing (SPEC §11) ──────────────────
//
// Everything that could reach a response body, a page or a log is scrubbed here
// first: credentials, auth headers and URLs carrying userinfo. Upstream error
// bodies are reduced to a short excerpt so a provider cannot echo anything large
// (or anything sensitive) back into the UI.

/** Any secret shorter than this is not string-replaced: it would match too much. */
const MIN_SECRET_LENGTH = 6;

export const REDACTED = '[redacted]';

/**
 * Credential values are removed from anything the model, a page or a log could
 * read, wherever they turn up: an upstream error that echoes a key is still
 * scrubbed when it does not look like a header (design §9.1).
 */
/**
 * An environment variable holds a credential when its name ends in KEY, TOKEN,
 * SECRET or PASSWORD (HAE_API_KEY, VITAL_PG_PASSWORD, OURA_SECRET, …). A rule by
 * name, not a list, so a credential added later is covered, and one an old
 * deployment still sets is covered too.
 */
export const isCredentialName = (name: string): boolean => /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name);

/** The credential values set in these environments, read now (never held between calls). */
export function credentialValues(...envs: (NodeJS.ProcessEnv | undefined)[]): string[] {
  return envs.flatMap(env =>
    Object.entries(env ?? {})
      .filter(([name]) => isCredentialName(name))
      .map(([, value]) => value?.trim())
      .filter((v): v is string => Boolean(v && v.length >= MIN_SECRET_LENGTH))
  );
}

/** `text` with every credential value of the process, and of the given environments, removed. */
export function redactCredentials(text: string, ...envs: (NodeJS.ProcessEnv | undefined)[]): string {
  let out = text;
  for (const secret of credentialValues(process.env, ...envs)) out = out.split(secret).join(REDACTED);
  return out;
}

/** Host only, for display. An unparseable URL has no host to show. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Remove credentials and auth header values from a string.
 *
 * Order matters: named header patterns are handled first, then literal secret
 * values, then URL userinfo.
 */
export function scrubText(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;

  // Authorization: Bearer <token>  /  x-api-key: <token>
  out = out.replace(/(authorization\s*:\s*)(bearer\s+)?\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(x-api-key\s*:\s*)\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(api[-_]?key["'\s:=]+)\S+/gi, `$1${REDACTED}`);

  // Literal secret values, wherever they appear: the ones given, and the process's own credentials.
  for (const secret of [...secrets, ...credentialValues(process.env)]) {
    const value = secret?.trim();
    if (value && value.length >= MIN_SECRET_LENGTH) {
      out = out.split(value).join(REDACTED);
    }
  }

  // URL userinfo: https://user:pass@host/... → https://[redacted]@host/...
  out = out.replace(/(https?:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`);

  return out;
}

/**
 * A short, single-line, scrubbed excerpt of an upstream body.
 * Never returns more than `max` characters and never returns a newline run.
 */
export function safeExcerpt(text: string, secrets: (string | null | undefined)[] = [], max = 280): string {
  const flat = scrubText(text, secrets).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}
/**
 * A reason for the MODEL to read: scrubbed like any error, and with every web
 * address replaced, so no host, URL or path of a source reaches a result (design §9.1).
 */
export function scrubForModel(text: string, max = 200): string {
  return safeExcerpt(text, [], max * 2)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address]')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|cloud|local|lan|home|internal|example|test)\b(?::\d+)?(?:\/\S*)?/gi, '[address]')
    .slice(0, max);
}
