// ── Settings → Connections → Hevy: state and the save call ──────────────────
//
// Pure helpers behind the card. Nothing here keeps a key: `saveHevy` takes it as
// an argument, puts it in the request body and returns only the server's answer.

import { maskedKey } from './hae-card';

export { maskedKey };

/** The shape GET /api/sources/hevy returns. It never contains the key. */
export interface HevyStatusView {
  /** VITAL_SECRET_KEY is present and usable, so a connection can be stored. */
  available: boolean;
  configured: boolean;
  /** The stored API URL; null when blank (Hevy's own API). */
  url: string | null;
  keyLast4: string | null;
  needsReentry: boolean;
  lastError: { kind: string; message: string } | null;
}

export type HevyCardState = 'not_available' | 'not_connected' | 'connected' | 'needs_reentry' | 'error';

export const HEVY_PATH = '/api/sources/hevy';

export function hevyCardState(status: HevyStatusView): HevyCardState {
  if (!status.available) return 'not_available';
  if (!status.configured) return 'not_connected';
  if (status.needsReentry) return 'needs_reentry';
  return status.lastError ? 'error' : 'connected';
}

/**
 * Whether Save can be pressed. The URL is optional (blank means Hevy's own API). A key
 * is needed unless one is stored and the form is the Change form, where a blank key
 * means "keep the stored key".
 */
export function canSaveHevy(status: HevyStatusView, editing: boolean, apiKey: string): boolean {
  if (!status.available) return false;
  const storedKeyKept = editing && status.configured && !status.needsReentry;
  return storedKeyKept || apiKey.trim().length > 0;
}

export type SaveHevyResult = { ok: true; status: HevyStatusView } | { ok: false; message: string };

/**
 * PUT the connection. A blank key is left out of the body so the server keeps the stored
 * one; the URL is always sent, and blank clears it. A refusal comes back as the
 * server's own plain message.
 */
export async function saveHevy(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<SaveHevyResult> {
  const body: { url: string; apiKey?: string } = { url: url.trim() };
  if (apiKey.trim()) body.apiKey = apiKey.trim();
  let res: Response;
  try {
    res = await fetchImpl(HEVY_PATH, {
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
  if (res.ok && payload && typeof payload === 'object') return { ok: true, status: payload as HevyStatusView };
  const message =
    payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `The connection could not be saved (HTTP ${res.status}).`;
  return { ok: false, message };
}
