import { describe, expect, it } from 'vitest';
import { checkKey, listModels, modelListUrl } from './models';

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('the model-list address', () => {
  it('sits next to the request endpoint for each protocol', () => {
    expect(modelListUrl('openai', 'https://openrouter.ai/api/v1')).toEqual({ url: 'https://openrouter.ai/api/v1/models', host: 'openrouter.ai' });
    expect(modelListUrl('openai', 'http://127.0.0.1:1234/v1/chat/completions')).toMatchObject({ url: 'http://127.0.0.1:1234/v1/models' });
    expect(modelListUrl('anthropic', 'https://api.anthropic.com')).toMatchObject({ url: 'https://api.anthropic.com/v1/models?limit=1000' });
    expect(modelListUrl('anthropic', 'https://api.anthropic.com/v1')).toMatchObject({ url: 'https://api.anthropic.com/v1/models?limit=1000' });
    expect(modelListUrl('openai', 'nope')).toHaveProperty('reason');
  });
});

describe('listModels', () => {
  it('reads and sorts the ids, without duplicates', async () => {
    const result = await listModels(
      { kind: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k' },
      { timeoutMs: 1000, fetchImpl: respond(200, { data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { name: 'no id' }] }) }
    );
    expect(result).toEqual({ outcome: 'ok', models: ['a', 'b'], host: 'x.example' });
  });

  it('sends the Anthropic headers', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await listModels({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'ak' }, { timeoutMs: 1000, fetchImpl });
    expect(headers['x-api-key']).toBe('ak');
    expect(headers['anthropic-version']).toBeTruthy();
    expect(headers.Authorization).toBeUndefined();
  });

  it('tells a refused key, a missing list, a bad answer and a dead server apart', async () => {
    const target = { kind: 'openai' as const, baseUrl: 'https://x.example/v1', apiKey: null };
    expect((await listModels(target, { timeoutMs: 1000, fetchImpl: respond(401, {}) })).outcome).toBe('unauthorised');
    expect((await listModels(target, { timeoutMs: 1000, fetchImpl: respond(404, {}) })).outcome).toBe('not_listed');
    expect((await listModels(target, { timeoutMs: 1000, fetchImpl: respond(200, { nope: true }) })).outcome).toBe('invalid_payload');
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect((await listModels(target, { timeoutMs: 1000, fetchImpl: dead })).outcome).toBe('unreachable');
  });

  it('gives up at the timeout', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      )) as unknown as typeof fetch;
    const result = await listModels({ kind: 'openai', baseUrl: 'https://x.example/v1', apiKey: null }, { timeoutMs: 20, fetchImpl: hang });
    expect(result.outcome).toBe('timeout');
  });
});

describe('checkKey', () => {
  const target = { kind: 'openai' as const, baseUrl: 'https://x.example/v1', apiKey: 'k' };

  it('reads 401/403 as refused and anything else as accepted, with an empty body to the request endpoint', async () => {
    let seen: { url: string; body: unknown } | null = null;
    const record = (status: number) =>
      (async (url: string, init: RequestInit) => {
        seen = { url, body: init.body };
        return new Response('{}', { status });
      }) as unknown as typeof fetch;
    expect(await checkKey(target, { timeoutMs: 1000, fetchImpl: record(401) })).toBe('refused');
    expect(seen).toEqual({ url: 'https://x.example/v1/chat/completions', body: '{}' });
    expect(await checkKey(target, { timeoutMs: 1000, fetchImpl: record(403) })).toBe('refused');
    expect(await checkKey(target, { timeoutMs: 1000, fetchImpl: record(400) })).toBe('accepted');
  });

  it('asks nothing without a key, and is unknown when the server cannot be reached', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await checkKey({ ...target, apiKey: null }, { timeoutMs: 1000, fetchImpl: spy })).toBe('unknown');
    expect(called).toBe(false);
    expect(await checkKey(target, { timeoutMs: 1000, fetchImpl: spy })).toBe('unknown');
  });
});
