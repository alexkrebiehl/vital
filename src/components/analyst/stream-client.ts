'use client';

// ── Analyst streaming client (SPEC §8) ──────────────────
//
// Reads the `text/event-stream` the streaming route re-emits and turns it into
// callbacks the page can render as they arrive. The frame parsing is shared with
// the server (`@/lib/analyst/stream` is pure TypeScript with no server imports),
// so the client and the server cannot disagree about what a frame means.
//
// Two guarantees this module makes plain:
//   * reasoning and answer are delivered through DIFFERENT callbacks, so the UI
//     can style them apart and the answer is never polluted with reasoning;
//   * a stream that fails before the terminal `result` frame THROWS, so the
//     caller can fall back to the non-streaming endpoint instead of being left
//     with a half-rendered turn.

import { splitSseFrames } from '@/lib/analyst/stream';
import type { AnalystResponse } from '@/lib/analyst/types';

export interface AnalystStreamHandlers {
  onReasoning: (text: string) => void;
  onAnswer: (text: string) => void;
  onResult: (response: AnalystResponse & Record<string, unknown>) => void;
}

export interface AnalystStreamRequest {
  query: string;
  system: 'metric' | 'imperial';
  conversationId: number | null;
  notes?: string;
}

/** A structured stream failure, so the caller can fall back deliberately. */
export class AnalystStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalystStreamError';
  }
}

/**
 * Prefer streaming, fall back to the non-streaming endpoint.
 *
 * This is the ONE decision the page makes about which transport to use, kept
 * here so it can be exercised without a DOM. When streaming throws (a non-OK
 * endpoint, a broken body, a stream that ends without a `result`), the fallback
 * runs and the user still gets an answer. The fallback's own failure is what
 * propagates — a genuinely unanswerable question must not be hidden by a
 * successful-looking stream.
 */
export async function askWithStreamingFallback(
  streaming: () => Promise<void>,
  nonStreaming: () => Promise<void>
): Promise<{ usedStreaming: boolean }> {
  try {
    await streaming();
    return { usedStreaming: true };
  } catch {
    await nonStreaming();
    return { usedStreaming: false };
  }
}

/**
 * Ask the analyst over the streaming endpoint.
 *
 * Resolves once the terminal `result` frame has been delivered. Throws an
 * `AnalystStreamError` when the endpoint answers non-OK, the body is missing, the
 * stream breaks before `result`, or it ends without one — every case the caller
 * should answer by falling back to the non-streaming route.
 */
export async function askAnalystStreaming(
  request: AnalystStreamRequest,
  handlers: AnalystStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/analyst/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new AnalystStreamError(`The analyst stream answered HTTP ${res.status}.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawResult = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = splitSseFrames(buffer);
      buffer = remainder;
      for (const frame of frames) {
        const parsed = parseClientFrame(frame);
        if (!parsed) continue;
        if (parsed.event === 'result') {
          sawResult = true;
          handlers.onResult(parsed.data as AnalystResponse & Record<string, unknown>);
        } else if (parsed.event === 'reasoning') {
          handlers.onReasoning(String((parsed.data as { text?: unknown }).text ?? ''));
        } else if (parsed.event === 'answer') {
          handlers.onAnswer(String((parsed.data as { text?: unknown }).text ?? ''));
        }
      }
    }
  } catch (error) {
    if (error instanceof AnalystStreamError) throw error;
    throw new AnalystStreamError(error instanceof Error ? error.message : 'The analyst stream failed.');
  } finally {
    reader.releaseLock();
  }

  if (!sawResult) throw new AnalystStreamError('The analyst stream ended without a final result.');
}

/** Read one SSE frame's `event:` name and JSON `data:` payload. */
function parseClientFrame(frame: string): { event: string; data: unknown } | null {
  let event = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimStart();
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    // A keepalive or comment frame is not JSON and is ignored.
    return null;
  }
}
