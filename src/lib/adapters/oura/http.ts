// ── Oura HTTP plumbing (SERVER ONLY) ─────────────────────
//
// What the OAuth helpers and the data client share: injectable dependencies and
// a fetch with a timeout. A thrown error here carries no URL (a revoke URL holds
// a token) and no header (the Authorization header holds one too).

import { DEFAULT_DATA_TIMEOUT_MS } from '@/lib/adapters/hae';

export interface OuraHttpDeps {
  fetchImpl?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Per-request timeout. Defaults to the HAE data timeout (20 s). */
  timeoutMs?: number;
}

export type TimedFetchFailure = 'timeout' | 'network_error';

export class TimedFetchError extends Error {
  constructor(readonly kind: TimedFetchFailure) {
    super(kind === 'timeout' ? 'The request timed out.' : 'The request could not be completed.');
    this.name = 'TimedFetchError';
  }
}

/** fetch with a timeout. Throws only `TimedFetchError`, with a fixed message. */
export async function timedFetch(url: string, init: RequestInit, deps: OuraHttpDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) throw new TimedFetchError('network_error');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DATA_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch {
    throw new TimedFetchError(timedOut ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }
}
