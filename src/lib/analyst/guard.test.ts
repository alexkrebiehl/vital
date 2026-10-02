// The runaway guard: a model that reasons or writes without end is stopped, with a message
// that names the limit and the setting; a long but bounded answer is left alone.

import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamGuard } from './guard';
import { AnalystProviderError } from './provider';
import { streamAnalyst, type AnalystStreamChunk } from './service';

const LIMITS = { maxReasoningChars: 100, maxAnswerChars: 200, questionTimeoutMs: 1000 };

describe('StreamGuard', () => {
  it('lets reasoning and answer text through up to their limits, per turn', () => {
    const g = new StreamGuard(LIMITS);
    g.beginTurn();
    g.reasoning('x'.repeat(100));
    g.answer('y'.repeat(200));
    // A new model turn starts the counters again.
    g.beginTurn();
    g.reasoning('x'.repeat(100));
    expect(g.reason).toBeNull();
  });

  it('stops endless reasoning and says which limit and which setting', () => {
    const g = new StreamGuard(LIMITS);
    g.beginTurn();
    g.reasoning('x'.repeat(60));
    expect(() => g.reasoning('x'.repeat(60))).toThrow(AnalystProviderError);
    expect(g.reason).toMatch(/kept reasoning for more than 100 characters/);
    expect(g.reason).toMatch(/ANALYST_MAX_REASONING_CHARS/);
  });

  it('stops an endless reply', () => {
    const g = new StreamGuard(LIMITS);
    g.beginTurn();
    expect(() => g.answer('y'.repeat(201))).toThrow(/ANALYST_MAX_ANSWER_CHARS/);
  });

  it('stops a question past its deadline, at the next turn, with the clock injected', () => {
    let t = 1_000;
    const g = new StreamGuard(LIMITS, () => t);
    g.beginTurn();
    t += 999;
    expect(g.remainingMs()).toBe(1);
    g.beginTurn();
    t += 2;
    expect(() => g.beginTurn()).toThrow(/1-second limit.*ANALYST_QUESTION_TIMEOUT_MS/);
  });

  it('keeps the first reason when the timer and a counter both trip', () => {
    const g = new StreamGuard(LIMITS);
    g.beginTurn();
    g.markExpired();
    const first = g.reason;
    expect(first).toMatch(/limit and was stopped/);
    expect(() => g.reasoning('x'.repeat(500))).toThrow(first as string);
    expect(g.reason).toBe(first);
  });
});

// ── End to end: a model that never stops ────────────────

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections?.(); });
});

/** A model server that streams `frame()` every few ms until the client hangs up. */
async function endlessModel(frame: () => unknown) {
  let open = 0;
  let sent = 0;
  let closedByClient = false;
  const server = createServer((req, res: ServerResponse) => {
    req.on('data', () => {});
    req.on('end', () => {
      open++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const timer = setInterval(() => {
        sent++;
        res.write(`data: ${JSON.stringify(frame())}\n\n`);
      }, 2);
      res.on('close', () => {
        clearInterval(timer);
        closedByClient = true;
      });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, stats: () => ({ open, sent, closedByClient }) };
}

const envFor = (url: string, extra: Record<string, string> = {}) =>
  ({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: url, ANALYST_MODEL: 'm', ANALYST_API_KEY: 'k', VITAL_DATA_MODE: 'demo', ...extra }) as unknown as NodeJS.ProcessEnv;

async function collect(chunks: AsyncGenerator<AnalystStreamChunk>) {
  const out: AnalystStreamChunk[] = [];
  for await (const c of chunks) out.push(c);
  return out;
}

const reasoningFrame = () => ({ choices: [{ delta: { reasoning: 'Hmm, let me think again about the same thing. ' } }] });
const answerFrame = () => ({ choices: [{ delta: { content: 'more and more words ' } }] });

describe('a model that never stops, through the streamed service', () => {
  for (const tools of ['auto', 'off'] as const) {
    it(`cuts endless reasoning and hangs up on the model (tools ${tools})`, async () => {
      const model = await endlessModel(reasoningFrame);
      const env = envFor(model.url, { ANALYST_TOOLS: tools, ANALYST_MAX_REASONING_CHARS: '2000', ANALYST_QUESTION_TIMEOUT_MS: '60000' });
      const chunks = await collect(streamAnalyst({ query: 'Tell me about my sleep this month' }, { env }).chunks);
      const result = chunks.find(c => c.kind === 'result');
      expect(result?.kind).toBe('result');
      if (result?.kind !== 'result') return;
      expect(result.response.status).toBe('error');
      expect(result.response.message).toMatch(/kept reasoning for more than 2,000 characters/);
      expect(result.response.answer).toBeNull();
      // The reasoning shown stops near the limit instead of growing without end.
      const shown = chunks.filter(c => c.kind === 'reasoning').reduce((n, c) => n + (c.kind === 'reasoning' ? c.text.length : 0), 0);
      expect(shown).toBeLessThan(2000 + 200);
      // And the connection to the model is closed, not left generating.
      await new Promise(r => setTimeout(r, 100));
      expect(model.stats().closedByClient).toBe(true);
    });
  }

  it('cuts an endless reply', async () => {
    const model = await endlessModel(answerFrame);
    const env = envFor(model.url, { ANALYST_TOOLS: 'off', ANALYST_MAX_ANSWER_CHARS: '1500' });
    const chunks = await collect(streamAnalyst({ query: 'Tell me about my sleep this month' }, { env }).chunks);
    const result = chunks.find(c => c.kind === 'result');
    expect(result?.kind === 'result' && result.response.message).toMatch(/reply ran past 1,500 characters/);
  });

  it('cuts a model that goes silent at the question deadline', async () => {
    // Headers sent, then nothing: no counter can trip, only the clock can.
    const server = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify(reasoningFrame())}\n\n`);
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const env = envFor(url, { ANALYST_TOOLS: 'auto', ANALYST_QUESTION_TIMEOUT_MS: '1000' });
    const started = Date.now();
    const chunks = await collect(streamAnalyst({ query: 'Tell me about my sleep this month' }, { env }).chunks);
    const result = chunks.find(c => c.kind === 'result');
    expect(result?.kind === 'result' && result.response.message).toMatch(/1-second limit/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops when the caller aborts (the Stop button), and says nothing was answered', async () => {
    const model = await endlessModel(reasoningFrame);
    const env = envFor(model.url, { ANALYST_TOOLS: 'auto', ANALYST_MAX_REASONING_CHARS: '2000000', ANALYST_QUESTION_TIMEOUT_MS: '600000' });
    const { chunks, abort } = streamAnalyst({ query: 'Tell me about my sleep this month' }, { env });
    const seen: AnalystStreamChunk[] = [];
    for await (const c of chunks) {
      seen.push(c);
      if (seen.filter(x => x.kind === 'reasoning').length === 3) abort();
    }
    const result = seen.find(c => c.kind === 'result');
    expect(result?.kind === 'result' && result.response.answer).toBeNull();
    await new Promise(r => setTimeout(r, 100));
    expect(model.stats().closedByClient).toBe(true);
  });
});
