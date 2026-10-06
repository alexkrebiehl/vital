// ── Settings → Connections → Health Auto Export: state and the save call ────
//
// Pure helpers behind the card. Nothing here keeps a key: `saveHae` takes it as
// an argument, puts it in the request body and returns only the server's answer.

/** The shape GET /api/sources/hae returns. It never contains the key. */
export interface HaeStatusView {
  /** VITAL_SECRET_KEY is present and usable, so a connection can be stored. */
  available: boolean;
  configured: boolean;
  endpoint: string | null;
  keyLast4: string | null;
  needsReentry: boolean;
  lastError: { kind: string; message: string } | null;
}

export type HaeCardState = 'not_available' | 'not_connected' | 'connected' | 'needs_reentry' | 'error';

export const HAE_PATH = '/api/sources/hae';
export const HAE_KEY_COMMANDS = ['npm run db:init', 'openssl rand -base64 32'] as const;

export function haeCardState(status: HaeStatusView): HaeCardState {
  if (!status.available) return 'not_available';
  if (!status.configured) return 'not_connected';
  if (status.needsReentry) return 'needs_reentry';
  return status.lastError ? 'error' : 'connected';
}

/** Eight bullets, then the last 4 characters when the server reported them. */
export function maskedKey(last4: string | null): string {
  return `${'•'.repeat(8)}${last4 ?? ''}`;
}

/**
 * Whether Save can be pressed. A key is needed unless one is stored and the
 * form is the Change form, where a blank key means "keep the stored key".
 */
export function canSaveHae(status: HaeStatusView, editing: boolean, endpoint: string, apiKey: string): boolean {
  if (!status.available) return false;
  if (!endpoint.trim()) return false;
  const storedKeyKept = editing && status.configured && !status.needsReentry;
  return storedKeyKept || apiKey.trim().length > 0;
}

export type SaveHaeResult = { ok: true; status: HaeStatusView } | { ok: false; message: string };

/**
 * PUT the connection. A blank key is left out of the body so the server keeps
 * the stored one. A refusal comes back as the server's own plain message.
 */
export async function saveHae(
  endpoint: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<SaveHaeResult> {
  const body: { endpoint: string; apiKey?: string } = { endpoint: endpoint.trim() };
  if (apiKey.trim()) body.apiKey = apiKey.trim();
  let res: Response;
  try {
    res = await fetchImpl(HAE_PATH, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'The connection could not be saved: Vital could not be reached.' };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok && payload && typeof payload === 'object') return { ok: true, status: payload as HaeStatusView };
  const message =
    payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `The connection could not be saved (HTTP ${res.status}).`;
  return { ok: false, message };
}

/**
 * What the page does once the connection changed. On first run a save opens the app
 * with a full page load; everywhere else the server-rendered data is refreshed in place.
 */
export function nextStepAfterChange(event: 'saved' | 'disconnected', settingUp: boolean): 'open-app' | 'refresh' {
  return event === 'saved' && settingUp ? 'open-app' : 'refresh';
}
