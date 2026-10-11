import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAiTables } from '@/lib/db/ai-store.fake';
import { redactCredentials } from '@/lib/analyst/scrub';
import {
  createProvider,
  editProvider,
  listAssignmentStatus,
  listProviderStatus,
  normalizeBaseUrl,
  providerModels,
  removeProvider,
  saveAssignment,
  type AiConnectDeps,
} from './connect';
import { readAiSettings, resetAiSettingsCache } from './settings';

const SECRET = randomBytes(32).toString('base64');
const KEY = 'sk-provider-key-that-must-never-leak-9876';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A provider that lists two models, refuses a wrong key and records what it was sent. */
function server(options: { status?: number; fail?: boolean } = {}) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    if (options.fail) throw new Error('connect ECONNREFUSED');
    if (options.status) return json({ error: { message: `echo ${KEY}` } }, options.status);
    return json({ data: [{ id: 'model-b' }, { id: 'model-a' }] });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

function setup(extra: Partial<AiConnectDeps> = {}) {
  const client = fakeAiTables();
  let n = 0;
  const deps: AiConnectDeps = {
    env: { VITAL_SECRET_KEY: SECRET } as unknown as NodeJS.ProcessEnv,
    client,
    userId: 'owner',
    newId: () => `p${++n}`,
    fetchImpl: server().fetchImpl,
    ...extra,
  };
  return { client, deps };
}

const post = (body: unknown) =>
  new Request('http://localhost/api/ai/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (body: unknown) =>
  new Request('http://localhost/api/ai/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const OPENROUTER = { name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1/', apiKey: KEY };

afterEach(() => resetAiSettingsCache());

describe('adding a provider', () => {
  it('probes it, stores it, and answers with its models but never its key', async () => {
    const { fetchImpl, seen } = server();
    const { client, deps } = setup({ fetchImpl });
    const res = await createProvider(post(OPENROUTER), deps);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text);
    expect(body.models).toEqual(['model-a', 'model-b']);
    expect(body.providers[0]).toMatchObject({ id: 'p1', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', host: 'openrouter.ai', hasKey: true, keyLast4: '9876', usedBy: [] });
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/models');
    expect(seen[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(client.providers.size).toBe(1);
  });

  it('stores nothing when the probe fails, and says why without echoing the key', async () => {
    for (const [fake, kind] of [[server({ status: 401 }), 'unauthorised'], [server({ fail: true }), 'unreachable'], [server({ status: 500 }), 'http_error']] as const) {
      const { client, deps } = setup({ fetchImpl: fake.fetchImpl });
      const res = await createProvider(post(OPENROUTER), deps);
      expect(res.status).toBe(422);
      const text = await res.text();
      expect(JSON.parse(text).kind).toBe(kind);
      expect(text).not.toContain(KEY);
      expect(client.providers.size).toBe(0);
    }
  });

  it('refuses a key the server rejects even when its model list is public (OpenRouter)', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (init?.method === 'POST') {
        expect(init.body).toBe('{}');
        return json({ error: { message: 'No auth credentials found' } }, 401);
      }
      return json({ data: [{ id: 'model-a' }] });
    }) as unknown as typeof fetch;
    const { client, deps } = setup({ fetchImpl });
    const res = await createProvider(post(OPENROUTER), deps);
    expect(res.status).toBe(422);
    expect((await res.json()).kind).toBe('unauthorised');
    expect(calls).toEqual(['GET https://openrouter.ai/api/v1/models', 'POST https://openrouter.ai/api/v1/chat/completions']);
    expect(client.providers.size).toBe(0);
  });

  it('accepts a server with no model list (404), and says the model id is typed', async () => {
    const fetchImpl = (async () => json({}, 404)) as unknown as typeof fetch;
    const { deps } = setup({ fetchImpl });
    const res = await createProvider(post(OPENROUTER), deps);
    expect(res.status).toBe(201);
    expect((await res.json()).note).toMatch(/type the model id/);
  });

  it('requires a key off this machine, but not for a local server', async () => {
    const { deps } = setup();
    expect((await createProvider(post({ ...OPENROUTER, apiKey: '' }), deps)).status).toBe(400);
    const local = await createProvider(post({ name: 'LM Studio', kind: 'openai', baseUrl: 'http://host.docker.internal:1234/v1' }), deps);
    expect(local.status).toBe(201);
    expect((await local.json()).providers[0]).toMatchObject({ hasKey: false, loopback: true });
  });

  it('refuses a bad address, a missing name, an unknown type and a duplicate name', async () => {
    const { deps } = setup();
    expect((await createProvider(post({ ...OPENROUTER, baseUrl: 'https://user:pw@example.com' }), deps)).status).toBe(400);
    expect((await createProvider(post({ ...OPENROUTER, name: ' ' }), deps)).status).toBe(400);
    expect((await createProvider(post({ ...OPENROUTER, kind: 'gemini' }), deps)).status).toBe(400);
    expect((await createProvider(post(OPENROUTER), deps)).status).toBe(201);
    expect((await createProvider(post(OPENROUTER), deps)).status).toBe(409);
  });

  it('cannot store a key without a secret key, or anything without a database', async () => {
    const noSecret = setup({ env: {} as NodeJS.ProcessEnv });
    expect((await createProvider(post(OPENROUTER), noSecret.deps)).status).toBe(503);
    const noDb = setup({ client: null });
    expect((await createProvider(post(OPENROUTER), noDb.deps)).status).toBe(503);
    const listing = await (await listProviderStatus(noDb.deps)).json();
    expect(listing).toEqual({ available: true, database: false, providers: [] });
  });
});

describe('changing and removing a provider', () => {
  it('keeps the stored key when the key is left blank', async () => {
    const { fetchImpl, seen } = server();
    const { client, deps } = setup({ fetchImpl });
    await createProvider(post(OPENROUTER), deps);
    const res = await editProvider('p1', put({ ...OPENROUTER, name: 'Router', apiKey: '' }), deps);
    expect(res.status).toBe(200);
    expect(seen.at(-1)!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(client.providers.get('p1')).toMatchObject({ name: 'Router', revision: 2 });
    const settings = await readAiSettings({ aiClient: client, env: deps.env, userId: 'owner' });
    expect(settings.providers[0].apiKey).toBe(KEY);
  });

  it('asks for a key written under another secret key to be typed again', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    const rotated = { ...deps, env: { VITAL_SECRET_KEY: randomBytes(32).toString('base64') } as unknown as NodeJS.ProcessEnv };
    const listing = await (await listProviderStatus(rotated)).json();
    expect(listing.providers[0]).toMatchObject({ needsReentry: true, keyLast4: null });
    expect((await editProvider('p1', put({ ...OPENROUTER, apiKey: '' }), rotated)).status).toBe(400);
    expect((await editProvider('p1', put(OPENROUTER), rotated)).status).toBe(200);
  });

  it('answers another user’s provider as not found', async () => {
    const { client, deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    const sam = { ...deps, userId: 'sam' };
    expect((await editProvider('p1', put(OPENROUTER), sam)).status).toBe(404);
    expect((await removeProvider('p1', sam)).status).toBe(404);
    expect((await providerModels('p1', sam)).status).toBe(404);
    expect(client.providers.size).toBe(1);
  });

  it('removes a provider and every choice that used it', async () => {
    const { client, deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'model-a', options: {}, revision: 0 }), deps);
    expect((await removeProvider('p1', deps)).status).toBe(204);
    expect(client.assignments.size).toBe(0);
  });

  it('lists a provider’s models for the picker, and turns a failure into a note', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    expect(await (await providerModels('p1', deps)).json()).toEqual({ models: ['model-a', 'model-b'], note: null });
    const down = await (await providerModels('p1', { ...deps, fetchImpl: server({ fail: true }).fetchImpl })).json();
    expect(down.models).toEqual([]);
    expect(down.note).toMatch(/could not be reached/);
  });
});

describe('choosing a model for each use', () => {
  it('stores a choice with its options validated, and lists it with the provider marked as used', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    const res = await saveAssignment(
      put({ use: 'summary', providerId: 'p1', model: 'model-a', options: { maxTokens: '5000', temperature: 7, reasoningEffort: 'low' }, revision: 0 }),
      deps
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignments.summary).toEqual({ providerId: 'p1', model: 'model-a', options: { maxTokens: 5000, reasoningEffort: 'low' }, revision: 1 });
    expect(body.assignments.analyst).toBeNull();
    const listing = await (await listProviderStatus(deps)).json();
    expect(listing.providers[0].usedBy).toEqual(['summary']);
  });

  it('refuses a stale revision with the current choice', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'model-a', revision: 0 }), deps);
    const stale = await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'model-b', revision: 0 }), deps);
    expect(stale.status).toBe(409);
    expect((await stale.json()).current).toMatchObject({ model: 'model-a', revision: 1 });
  });

  it('clears a use', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'model-a', revision: 0 }), deps);
    const cleared = await saveAssignment(put({ use: 'analyst', providerId: null, revision: 1 }), deps);
    expect((await cleared.json()).assignments.analyst).toBeNull();
  });

  it('refuses an unknown use, a missing model, and another user’s provider', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    expect((await saveAssignment(put({ use: 'chat', providerId: 'p1', model: 'm', revision: 0 }), deps)).status).toBe(400);
    expect((await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: ' ', revision: 0 }), deps)).status).toBe(400);
    const sam = { ...deps, userId: 'sam' };
    expect((await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'm', revision: 0 }), sam)).status).toBe(404);
    expect(await (await listAssignmentStatus(sam)).json()).toMatchObject({ assignments: { analyst: null } });
  });

  it('is read straight back by the consumers once saved (the cache is dropped)', async () => {
    const { client, deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    const read = () => readAiSettings({ aiClient: client, env: deps.env, userId: 'owner' });
    expect((await read()).assignments).toEqual([]);
    await saveAssignment(put({ use: 'analyst', providerId: 'p1', model: 'model-a', revision: 0 }), deps);
    expect((await read()).assignments.map(a => a.model)).toEqual(['model-a']);
  });
});

describe('the stored keys', () => {
  it('are redacted from any text once read or typed', async () => {
    const { deps } = setup();
    await createProvider(post(OPENROUTER), deps);
    expect(redactCredentials(`the server said ${KEY}`)).toBe('the server said [redacted]');
  });

  it('settings that cannot be read are reported, not treated as empty', async () => {
    const { client, deps } = setup();
    client.failNext = new Error('connection reset');
    const settings = await readAiSettings({ aiClient: client, env: deps.env, userId: 'owner' });
    expect(settings.unavailable).toMatch(/could not be read/);
  });
});

describe('normalizeBaseUrl', () => {
  it('trims, drops trailing slashes, and refuses credentials, queries and other schemes', () => {
    expect(normalizeBaseUrl(' https://api.openai.com/v1/ ')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('ftp://x')).toBeNull();
    expect(normalizeBaseUrl('https://a:b@x.com')).toBeNull();
    expect(normalizeBaseUrl('https://x.com/v1?key=1')).toBeNull();
    expect(normalizeBaseUrl(42)).toBeNull();
  });
});
