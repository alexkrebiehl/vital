// ── Medications reads for the browser ───────────────────────────────────────
//
// The one read the Medications surface makes, and nothing else: a bounded window
// through `/api/medications`. The route calls the HAE adapter server-side; the
// browser never receives the read token and never calls the upstream API itself.
//
// NO HEALTH VALUE IS EVER LOGGED: a failure is reported as the route's own
// message, never as a value. Nothing is invented on a failure — an unreadable
// read returns an error the page shows, and the page never substitutes zeroes,
// demo rows or a plausible guess.

import type { MedicationCoverage, MedicationRecord } from '@/lib/adapters/medications';

/** The read model `/api/medications` serves. */
export interface MedicationReadResponse {
  /** False when the source is not configured or could not be read. */
  available: boolean;
  /** Why the read is unavailable, or why it failed. Null on a successful read. */
  reason: string | null;
  /** The bounds the upstream request was sent with (echoed back). */
  window: { from: string; to: string } | null;
  /** The span the returned records actually cover, or null when none are attributable. */
  covered: MedicationCoverage | null;
  records: MedicationRecord[];
  /** The source named in words — never a host, a token or a path. */
  source: string;
}

export class MedicationReadError extends Error {}

async function readJson(url: string): Promise<MedicationReadResponse> {
  const res = await fetch(url, { cache: 'no-store' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `The medications endpoint answered HTTP ${res.status} with no usable message.`;
    throw new MedicationReadError(message);
  }
  if (body === null) {
    throw new MedicationReadError(
      `The medications endpoint answered HTTP ${res.status} with a body that was not JSON.`
    );
  }
  const raw = body as Partial<MedicationReadResponse>;
  return {
    available: raw.available ?? false,
    reason: raw.reason ?? null,
    window: raw.window ?? null,
    covered: raw.covered ?? null,
    records: (raw.records ?? []) as MedicationRecord[],
    source: raw.source ?? 'Health Auto Export',
  };
}

/** The windowed medication read: `/api/medications?from=…&to=…`. */
export async function fetchMedications(
  window: { from: string; to: string }
): Promise<MedicationReadResponse> {
  const params = new URLSearchParams({ from: window.from, to: window.to });
  return readJson(`/api/medications?${params.toString()}`);
}
