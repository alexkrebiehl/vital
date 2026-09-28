// ── SSE frame parsing (SPEC §8) ─────────────────────────
//
// The field that was wrong-looking: this gateway streams the model's reasoning in
// `delta.reasoning` and its answer in `delta.content`. These tests pin both, and
// pin that `[DONE]` ends the stream — so a future change that read
// `reasoning_content`, or dropped the sentinel, fails here rather than silently
// losing reasoning or hanging the stream.

import { describe, expect, it } from 'vitest';
import { parseAnalystSse, readSseFrame, splitSseFrames, type AnalystStreamEvent } from '@/lib/analyst/stream';

/** Build a ReadableStream from a list of string chunks (as TCP would deliver them). */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<AnalystStreamEvent[]> {
  const out: AnalystStreamEvent[] = [];
  for await (const event of parseAnalystSse(body)) out.push(event);
  return out;
}

/** One SSE data frame, formatted the way the gateway sends it. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const REASONING_DELTA = {
  id: 'gen-mock',
  model: 'deepseek/deepseek-v4-flash-0731',
  choices: [
    {
      index: 0,
      delta: { content: '', role: 'assistant', reasoning: 'We' },
      finish_reason: null,
      native_finish_reason: null,
    },
  ],
};

describe('analyst SSE parsing (SPEC §8)', () => {
  it('separates delta.reasoning from delta.content', () => {
    const content = readSseFrame(
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { reasoning: 'thinking hard', content: '{"title":"x"}' }, finish_reason: null }],
      })}`
    );
    expect(content.reasoning).toBe('thinking hard');
    expect(content.answer).toBe('{"title":"x"}');
  });

  it('captures reasoning and answer as distinct events and ends at [DONE]', async () => {
    const events = await collect(
      streamOf(
        frame(REASONING_DELTA),
        frame({ choices: [{ index: 0, delta: { content: '{"title":"Resting' }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { content: ' heart rate"}' }, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n'
      )
    );

    const reasoning = events.filter(e => e.kind === 'reasoning').map(e => (e as { text: string }).text).join('');
    const answer = events.filter(e => e.kind === 'answer').map(e => (e as { text: string }).text).join('');
    expect(reasoning).toBe('We');
    expect(answer).toBe('{"title":"Resting heart rate"}');

    const done = events.at(-1);
    expect(done?.kind).toBe('done');
    expect((done as { finishReason: string | null }).finishReason).toBe('stop');
    // The done event is emitted exactly once.
    expect(events.filter(e => e.kind === 'done')).toHaveLength(1);
  });

  it('reads the model id and reasoning-token usage from the final chunk', () => {
    const content = readSseFrame(
      `data: ${JSON.stringify({
        model: 'deepseek/deepseek-v4-flash-0731',
        usage: { completion_tokens_details: { reasoning_tokens: 168 } },
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}`
    );
    expect(content.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(content.reasoningTokens).toBe(168);
  });

  it('does NOT treat reasoning_content as reasoning (this gateway uses delta.reasoning)', () => {
    const content = readSseFrame(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'other wire format' } }] })}`
    );
    expect(content.reasoning).toBe('');
  });
  it('reassembles a frame split across two TCP reads', () => {
    const whole = frame({ choices: [{ delta: { content: 'hello' } }] });
    const half = Math.floor(whole.length / 2);
    expect(splitSseFrames(whole.slice(0, half)).frames).toHaveLength(0);
    // The partial leading half is the remainder, to be prepended to the next read.
    expect(splitSseFrames(whole.slice(0, half)).remainder).toBe(whole.slice(0, half));
  });

  it('ignores a non-JSON frame instead of turning it into an answer', () => {
    const content = readSseFrame('data: keep-alive\n\n');
    expect(content.answer).toBe('');
    expect(content.done).toBe(false);
  });

  it('still ends the stream when [DONE] never arrives', async () => {
    // A gateway that closes the body without the sentinel must not hang the reader.
    const events = await collect(streamOf(frame({ choices: [{ delta: { content: '{"a":1}' } }] })));
    expect(events.filter(e => e.kind === 'answer').map(e => (e as { text: string }).text).join('')).toBe('{"a":1}');
    expect(events.at(-1)?.kind).toBe('done');
  });
});
