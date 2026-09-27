// ── Streaming client: frame parsing and the non-streaming fallback ───────────
//
// The client's job is to turn the SSE the route re-emits into reasoning/answer
// callbacks and to fall back when streaming does not work. Both are exercised
// here against a stubbed `fetch`, so the fallback decision is pinned without a
// DOM: a stream that fails must fall through to the non-streaming endpoint, and
// a stream that succeeds must not.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalystStreamError,
  askAnalystStreaming,
  askWithStreamingFallback,
  type AnalystStreamHandlers,
} from '@/components/analyst/stream-client';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A response whose body streams the given SSE text in one chunk. */
function sseResponse(text: string, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

function recordingHandlers() {
  const reasoning: string[] = [];
  const answer: string[] = [];
  const results: unknown[] = [];
  const handlers: AnalystStreamHandlers = {
    onReasoning: t => reasoning.push(t),
    onAnswer: t => answer.push(t),
    onResult: r => results.push(r),
  };
  return { handlers, reasoning, answer, results };
}

describe('analyst streaming client (SPEC §8)', () => {
  it('routes reasoning and answer frames to different callbacks and ends on result', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse(
        [
          'event: reasoning\ndata: {"kind":"reasoning","text":"thinking"}',
          'event: answer\ndata: {"kind":"answer","text":"{\\"title\\":"}',
          'event: answer\ndata: {"kind":"answer","text":"\\"x\\"}"}',
          'event: result\ndata: {"kind":"result","status":"ok","answer":null,"conversation":null}',
          '',
        ].join('\n\n')
      )
    ) as unknown as typeof fetch;

    const { handlers, reasoning, answer, results } = recordingHandlers();
    await askAnalystStreaming({ query: 'q', system: 'metric', conversationId: null }, handlers);

    expect(reasoning).toEqual(['thinking']);
    expect(answer.join('')).toBe('{"title":"x"}');
    expect(results).toHaveLength(1);
  });

  it('throws when the stream ends without a result, so the caller can fall back', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse('event: answer\ndata: {"kind":"answer","text":"partial"}')
    ) as unknown as typeof fetch;

    const { handlers } = recordingHandlers();
    await expect(
      askAnalystStreaming({ query: 'q', system: 'metric', conversationId: null }, handlers)
    ).rejects.toBeInstanceOf(AnalystStreamError);
  });

  it('throws on a non-OK streaming response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const { handlers } = recordingHandlers();
    await expect(
      askAnalystStreaming({ query: 'q', system: 'metric', conversationId: null }, handlers)
    ).rejects.toBeInstanceOf(AnalystStreamError);
  });

  it('uses the non-streaming fallback when streaming fails, and does not when it succeeds', async () => {
    const calls: string[] = [];
    const streaming = () => {
      calls.push('streaming');
      return Promise.reject(new AnalystStreamError('broken'));
    };
    const nonStreaming = () => {
      calls.push('non-streaming');
      return Promise.resolve();
    };

    const failed = await askWithStreamingFallback(streaming, nonStreaming);
    expect(failed.usedStreaming).toBe(false);
    expect(calls).toEqual(['streaming', 'non-streaming']);

    calls.length = 0;
    const ok = await askWithStreamingFallback(
      () => {
        calls.push('streaming');
        return Promise.resolve();
      },
      nonStreaming
    );
    expect(ok.usedStreaming).toBe(true);
    expect(calls).toEqual(['streaming']);
  });

  it('propagates the fallback failure rather than hiding it', async () => {
    await expect(
      askWithStreamingFallback(
        () => Promise.reject(new AnalystStreamError('broken')),
        () => Promise.reject(new Error('the endpoint answered HTTP 500'))
      )
    ).rejects.toThrow('HTTP 500');
  });
});
