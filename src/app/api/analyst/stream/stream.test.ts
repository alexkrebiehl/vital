// ── Streaming analyst service + route (SPEC §8) ─────────
//
// The streaming path is exercised end to end: a fake gateway that answers with
// real SSE frames, the service's stream generator, and the SSE the route
// re-emits. The three things that must hold:
//
//   * reasoning and answer arrive as SEPARATE events;
//   * the assembled streamed answer is what is validated — and what is persisted;
//   * when the stream fails before a result, the caller can fall back rather than
//     being left with a half turn.

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { retrieveGeneral } from '@/lib/analyst/retrieval';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
});

type Script = (res: ServerResponse, index: number) => void;

async function startSseServer(script: Script): Promise<string> {
  const server = createServer((req, res) => {
    // Drain the request body before answering. The analyst prompt is large, and
    // answering while the client is still writing resets the connection.
    req.on('data', () => {});
    req.on('end', () => script(res, 0));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}/v1`;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** A grounded analyst reply, built from the same bundle the service retrieves. */
function analystReplyText(): string {
  const bundle = retrieveGeneral();
  const sleep = bundle.summaries.find(s => s.metricId === 'sleep_analysis')!;
  return JSON.stringify({
    title: 'Streaming answer',
    observed: [`Time asleep averaged ${Math.round(sleep.aggregate.mean)} minutes across ${sleep.counts.evaluated} nights.`],
    interpretation: ['The window describes this period of the record.'],
    uncertainty: ['Nights without a recording are excluded.'],
    evidence: [{ metricId: 'sleep_analysis', windowLabel: 'selected window', aggregation: 'daily average', sampleCount: `${sleep.counts.evaluated} nights` }],
    followUps: ['How has my HRV changed over the same window?'],
  });
}

function openaiEnv(baseUrl: string): NodeJS.ProcessEnv {
  return {
    ANALYST_PROVIDER: 'openai',
    ANALYST_API_URL: baseUrl,
    ANALYST_MODEL: 'mock-analyst-1',
    ANALYST_API_KEY: 'sk-test-key-that-must-never-leak',
  } as unknown as NodeJS.ProcessEnv;
}

/** Drive the route handler with a JSON request, returning the raw SSE text. */
async function callStreamRoute(baseUrl: string, question: string): Promise<{ headers: Headers; text: string }> {
  const { POST } = await import('./route');
  const request = new Request('http://localhost/api/analyst/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: question }),
  });
  const response = await POST(request);
  const text = await response.text();
  return { headers: response.headers, text };
}

describe('streaming analyst route (SPEC §8)', () => {
  it('emits reasoning and answer as separate events and one terminal result', async () => {
    const baseUrl = await startSseServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Reasoning first, then the answer in two content deltas, then usage+DONE.
      res.write(sseChunk({ model: 'mock-analyst-1', choices: [{ delta: { reasoning: 'Let me check the window.' } }] }));
      const reply = analystReplyText();
      const half = Math.floor(reply.length / 2);
      res.write(sseChunk({ choices: [{ delta: { content: reply.slice(0, half) } }] }));
      res.write(sseChunk({ choices: [{ delta: { content: reply.slice(half) }, finish_reason: 'stop' }] }));
      res.write(sseChunk({ model: 'mock-analyst-1', usage: { completion_tokens_details: { reasoning_tokens: 12 } }, choices: [{ delta: {}, finish_reason: 'stop' }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });

    // Point the route at the mock by rewriting the process env it reads.
    const original = { ...process.env };
    Object.assign(process.env, openaiEnv(baseUrl));
    try {
      const { text } = await callStreamRoute(baseUrl, 'How has my sleep changed?');
      expect(text).toContain('event: reasoning');
      expect(text).toContain('event: answer');
      expect(text).toContain('event: result');

      // The reasoning frame carries the reasoning text, and it is NOT the answer.
      const reasoningFrames = text.split('\n\n').filter(f => f.startsWith('event: reasoning'));
      expect(reasoningFrames.join('')).toContain('Let me check the window.');

      // The terminal frame carries the finished answer with follow-ups.
      const resultFrame = text.split('\n\n').filter(f => f.startsWith('event: result')).at(-1)!;
      const payload = JSON.parse(resultFrame.split('\ndata: ')[1]) as {
        status: string;
        answer: { followUps: string[] } | null;
        model: string | null;
      };
      expect(payload.status).toBe('ok');
      expect(payload.answer).not.toBeNull();
      expect(payload.answer!.followUps.length).toBeGreaterThan(0);
      expect(payload.model).toBe('mock-analyst-1');
    } finally {
      process.env = original;
    }
  });

  it('ends the stream with an error result when the answer is unusable', async () => {
    const baseUrl = await startSseServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk({ choices: [{ delta: { content: 'not json at all' }, finish_reason: 'stop' }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const original = { ...process.env };
    Object.assign(process.env, openaiEnv(baseUrl));
    try {
      const { text } = await callStreamRoute(baseUrl, 'What changed this week?');
      const resultFrame = text.split('\n\n').filter(f => f.startsWith('event: result')).at(-1)!;
      const payload = JSON.parse(resultFrame.split('\ndata: ')[1]) as { status: string; answer: unknown };
      expect(payload.status).toBe('error');
      expect(payload.answer).toBeNull();
    } finally {
      process.env = original;
    }
  });
});

describe('streaming service generator (SPEC §8)', () => {
  it('yields reasoning, answer and one result, with reasoning kept out of the answer', async () => {
    const baseUrl = await startSseServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk({ choices: [{ delta: { reasoning: 'REASONING-ONLY-TEXT' } }] }));
      res.write(sseChunk({ choices: [{ delta: { content: analystReplyText() }, finish_reason: 'stop' }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const { streamAnalyst } = await import('@/lib/analyst/service');
    const { chunks } = streamAnalyst({ query: 'How has my sleep changed?' }, { env: openaiEnv(baseUrl) });

    const kinds: string[] = [];
    let result: { status: string; answer: unknown; message: string | null } | null = null;
    for await (const chunk of chunks) {
      kinds.push(chunk.kind);
      if (chunk.kind === 'result') result = chunk.response;
    }

    expect(kinds.filter(k => k === 'reasoning').length).toBeGreaterThan(0);
    expect(kinds.filter(k => k === 'answer').length).toBeGreaterThan(0);
    expect(kinds.filter(k => k === 'result')).toHaveLength(1);
    expect(result!.status).toBe('ok');
    // The reasoning text is never part of the validated answer.
    expect(JSON.stringify(result)).not.toContain('REASONING-ONLY-TEXT');
  });

  it('reports the reasoning-starved stream distinctly when it ends with no answer', async () => {
    const baseUrl = await startSseServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk({ choices: [{ delta: { reasoning: 'thinking…' } }] }));
      res.write(
        sseChunk({
          model: 'mock-analyst-1',
          usage: { completion_tokens_details: { reasoning_tokens: 8000 } },
          choices: [{ delta: {}, finish_reason: 'length' }],
        })
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const { streamAnalyst } = await import('@/lib/analyst/service');
    const { chunks } = streamAnalyst(
      { query: 'How is my resting heart rate trending?' },
      { env: openaiEnv(baseUrl) }
    );

    let result: { status: string; message: string | null } | null = null;
    for await (const chunk of chunks) if (chunk.kind === 'result') result = chunk.response;
    expect(result!.status).toBe('error');
    expect(result!.message).toMatch(/reasoning/);
  });
});
