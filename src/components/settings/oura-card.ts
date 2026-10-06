// ── Settings → Connections → Oura Ring: state and the save call ─────────────
//
// Pure helpers behind the card. Nothing here keeps a secret: `saveOuraApp`
// takes it as an argument, puts it in the request body and returns only the
// server's answer.

/** The shape GET /api/sources/oura returns: the login. It never contains a token. */
export interface OuraStatusView {
  configured: boolean;
  configProblem: string | null;
  connected: boolean;
  scopes: string[];
  missingScopes: string[];
  accessExpiresAt: string | null;
  needsReconnect: boolean;
  lastError: { kind: string; message: string } | null;
}

/** The shape GET /api/sources/oura/app returns: the app credentials. It never contains the secret. */
export interface OuraAppView {
  /** VITAL_SECRET_KEY is present and usable, so credentials can be stored. */
  available: boolean;
  configured: boolean;
  clientId: string | null;
  secretLast4: string | null;
  redirectUri: string | null;
  needsReentry: boolean;
}

export interface OuraFormValues {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type OuraCardState =
  | 'not_available'
  | 'app_missing'
  | 'needs_reentry'
  | 'ready'
  | 'connected'
  | 'needs_reconnect'
  | 'error';
export type OuraNotice = 'connected' | 'denied' | null;

export const OURA_PATH = '/api/sources/oura';
export const OURA_APP_PATH = '/api/sources/oura/app';
export const OURA_AUTHORIZE_PATH = '/api/sources/oura/authorize';
export const OURA_CALLBACK_PATH = '/api/sources/oura/callback';
export const OURA_KEY_COMMANDS = ['npm run db:init', 'openssl rand -base64 32'] as const;

export function ouraCardState(status: OuraStatusView, app: OuraAppView): OuraCardState {
  if (!app.available) return 'not_available';
  if (!app.configured) return 'app_missing';
  if (app.needsReentry) return 'needs_reentry';
  if (status.needsReconnect) return 'needs_reconnect';
  if (status.lastError) return 'error';
  return status.connected ? 'connected' : 'ready';
}

export function noticeFrom(value: string | null | undefined): OuraNotice {
  return value === 'connected' || value === 'denied' ? value : null;
}

/** The address Oura sends the reader back to, from the address the page is loaded from. */
export function defaultRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${OURA_CALLBACK_PATH}`;
}

/** Eight bullets, then the last 4 characters when the server reported them. */
export function maskedSecret(last4: string | null): string {
  return `${'•'.repeat(8)}${last4 ?? ''}`;
}

/**
 * Whether Save can be pressed. A secret is needed unless credentials are stored
 * and the form is the Change form, where a blank secret means "keep the stored one".
 */
export function canSaveOuraApp(app: OuraAppView, editing: boolean, form: OuraFormValues): boolean {
  if (!app.available) return false;
  if (!form.clientId.trim() || !form.redirectUri.trim()) return false;
  const storedSecretKept = editing && app.configured && !app.needsReentry;
  return storedSecretKept || form.clientSecret.trim().length > 0;
}

export type SaveOuraAppResult = { ok: true; app: OuraAppView; warnings: string[] } | { ok: false; message: string };

/**
 * PUT the credentials. A blank secret is left out of the body so the server
 * keeps the stored one. A refusal comes back as the server's own plain message.
 */
export async function saveOuraApp(values: OuraFormValues, fetchImpl: typeof fetch = fetch): Promise<SaveOuraAppResult> {
  const body: { clientId: string; redirectUri: string; clientSecret?: string } = {
    clientId: values.clientId.trim(),
    redirectUri: values.redirectUri.trim(),
  };
  if (values.clientSecret.trim()) body.clientSecret = values.clientSecret.trim();
  let res: Response;
  try {
    res = await fetchImpl(OURA_APP_PATH, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'The credentials could not be saved: Vital could not be reached.' };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok && payload && typeof payload === 'object') {
    const { warnings, ...app } = payload as OuraAppView & { warnings?: unknown };
    return {
      ok: true,
      app,
      warnings: Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : [],
    };
  }
  const message =
    payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `The credentials could not be saved (HTTP ${res.status}).`;
  return { ok: false, message };
}
