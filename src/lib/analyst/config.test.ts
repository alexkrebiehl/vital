import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAnalystConfig,
  clearPromptFileCache,
  isLoopbackHost,
  labAssistAllowed,
  normalizeEndpoint,
  publicConfigState,
} from '@/lib/analyst/config';
import { resolveAnalystConfig } from '@/lib/analyst/resolve-config';
import { aiSettingsFor, type UseSpec } from '@/lib/ai/test-settings';
import { selectionFor } from '@/lib/ai/types';
import { SUPPORTED_PROMPTS } from '@/lib/analyst/prompts';
import { DEFAULT_ANALYST_SYSTEM_PROMPT } from '@/lib/analyst/systemPrompt';

const KEY = 'sk-secret-value-that-must-never-leak';

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as unknown as NodeJS.ProcessEnv;
}

/** The analyst's configuration for a provider and model chosen in Settings. */
function configFor(spec: Partial<UseSpec> = {}, environment: NodeJS.ProcessEnv = env({})) {
  const settings = aiSettingsFor({ analyst: { baseUrl: 'https://openrouter.ai/api/v1', model: 'test/model', apiKey: KEY, name: 'OpenRouter', ...spec } });
  return buildAnalystConfig(selectionFor(settings, 'analyst'), environment);
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vital-analyst-'));
  tempDirs.push(dir);
  return dir;
}

describe('analyst configuration resolution (SPEC §8, §11)', () => {
  it('is the demo analyst with the built-in prompt and no key when nothing is chosen', () => {
    const config = buildAnalystConfig(null, env({}));
    expect(config.provider).toBe('demo');
    expect(config.providerDisplayName).toBe('Demo analyst');
    expect(config.misconfiguredReason).toBeNull();
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPrompt).toBe(DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(config.hasKey).toBe(false);
    expect(config.model).toBeNull();
  });

  it('ignores the old provider variables entirely', () => {
    const config = buildAnalystConfig(
      null,
      env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'https://api.openai.com/v1', ANALYST_MODEL: 'm', ANALYST_API_KEY: KEY, ANALYST_MAX_TOKENS: '9000' })
    );
    expect(config.provider).toBe('demo');
    expect(config.apiKey).toBeNull();
    expect(config.maxTokens).toBe(1200);
  });

  it('applies documented defaults for the request parameters', () => {
    const config = configFor();
    expect(config.maxTokens).toBe(1200);
    expect(config.temperature).toBe(0.2);
    expect(config.timeoutMs).toBe(60000);
    expect(config.jsonMode).toBe('auto');
    expect(config.tools).toBe('auto');
    expect(config.context).toBe('full');
    expect(config.reasoningEffort).toBeNull();
    expect(config.labAssist).toBe(true);
  });

  it('takes the tuning chosen in Settings and ignores out-of-range values', () => {
    const config = configFor({ options: { maxTokens: 4000, temperature: 0.7, jsonMode: 'off', reasoningEffort: 'low', labAssist: false } });
    expect(config.maxTokens).toBe(4000);
    expect(config.temperature).toBe(0.7);
    expect(config.jsonMode).toBe('off');
    expect(config.reasoningEffort).toBe('low');
    expect(config.labAssist).toBe(false);

    const bad = configFor({ options: { maxTokens: 'lots', temperature: 9, reasoningEffort: 'bogus', contextMaxChars: 10 } });
    expect(bad.maxTokens).toBe(1200);
    expect(bad.temperature).toBe(0.2);
    expect(bad.reasoningEffort).toBeNull();
    expect(bad.contextMaxChars).toBe(60_000);
  });

  it('still reads the timeouts from the environment', () => {
    const config = configFor({}, env({ ANALYST_TIMEOUT_MS: '15000', ANALYST_QUESTION_TIMEOUT_MS: '90000' }));
    expect(config.timeoutMs).toBe(15000);
    expect(config.questionTimeoutMs).toBe(90000);
    const bad = configFor({}, env({ ANALYST_TIMEOUT_MS: '-4' }));
    expect(bad.timeoutMs).toBe(60000);
  });

  it('resolves an OpenAI-compatible provider and normalizes its base URL', () => {
    const config = configFor();
    expect(config.provider).toBe('openai');
    expect(config.providerDisplayName).toBe('OpenRouter');
    expect(config.misconfiguredReason).toBeNull();
    expect(config.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(config.endpointHost).toBe('openrouter.ai');
    expect(config.endpointLoopback).toBe(false);
    expect(config.hasKey).toBe(true);
    expect(config.sendingCategories.length).toBeGreaterThan(0);
  });

  it('resolves an Anthropic provider', () => {
    const config = configFor({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', name: 'Anthropic' });
    expect(config.provider).toBe('anthropic');
    expect(config.endpoint).toBe('https://api.anthropic.com/v1/messages');
  });

  it('uses a full endpoint as-is, with or without a trailing slash', () => {
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions', 'openai').url
    ).toBe('https://api.example.com/v1/chat/completions');
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions/', 'openai').url
    ).toBe('https://api.example.com/v1/chat/completions');
    expect(normalizeEndpoint('https://api.anthropic.com/v1/messages', 'anthropic').url).toBe(
      'https://api.anthropic.com/v1/messages'
    );
  });

  it('appends the provider default path for the Anthropic provider', () => {
    expect(normalizeEndpoint('https://api.anthropic.com', 'anthropic').url).toBe('https://api.anthropic.com/v1/messages');
    expect(normalizeEndpoint('http://host.docker.internal:11434', 'anthropic').url).toBe(
      'http://host.docker.internal:11434/v1/messages'
    );
  });

  it('reports an invalid address as a misconfiguration that names where to fix it, instead of throwing', () => {
    const config = configFor({ baseUrl: 'not a url' });
    expect(config.misconfiguredReason).toContain('not a valid URL');
    expect(config.misconfiguredReason).toContain('Settings → Connections → AI providers');
    expect(config.endpoint).toBeNull();
    expect(configFor({ baseUrl: 'ftp://example.com' }).misconfiguredReason).toContain('http or https');
  });

  it('requires a model', () => {
    const config = configFor({ model: '  ' });
    expect(config.misconfiguredReason).toContain('No model is chosen for the Analyst');
    expect(config.misconfiguredReason).toContain('Settings → Preferences → AI models');
  });

  it('asks for the key again when it was stored under another secret key', () => {
    const config = configFor({ needsReentry: true });
    expect(config.misconfiguredReason).toContain('Enter it again');
    expect(config.apiKey).toBeNull();
  });

  it('requires a key for a non-loopback endpoint and not for a loopback one', () => {
    const remote = configFor({ baseUrl: 'https://api.openai.com/v1', apiKey: null, name: 'OpenAI' });
    expect(remote.misconfiguredReason).toContain('“OpenAI” needs an API key');

    for (const host of ['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']) {
      const local = configFor({ baseUrl: `http://${host}:1234/v1`, model: 'local-model', apiKey: null });
      expect(local.misconfiguredReason).toBeNull();
      expect(local.endpointLoopback).toBe(true);
      expect(local.hasKey).toBe(false);
      // A local model server still receives the selected summaries.
      expect(local.sendingCategories.length).toBeGreaterThan(0);
    }
  });

  it('classifies loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('host.docker.internal')).toBe(true);
    expect(isLoopbackHost('api.openai.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
  });

  it('never puts the key or a credential-bearing URL in the public state', () => {
    const config = configFor({ baseUrl: 'https://user:pass@api.example.com/v1', model: 'm' });
    expect(config.apiKey).toBe(KEY);
    const state = publicConfigState(config);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('user:pass');
    expect(state.destination).toBe('api.example.com');
    expect(state.hasKey).toBe(true);
    expect(state.configured).toBe(true);
  });

  it('reports a misconfigured provider as unconfigured in the public state', () => {
    const state = publicConfigState(configFor({ baseUrl: 'https://example.com/v1', apiKey: null }));
    expect(state.configured).toBe(false);
    expect(state.misconfigured).toBe(true);
    expect(state.misconfiguredReason).toContain('needs an API key');
  });

  it('allows the lab second pass only on a usable model with the switch on', () => {
    expect(labAssistAllowed(configFor())).toBe(true);
    expect(labAssistAllowed(configFor({ options: { labAssist: false } }))).toBe(false);
    expect(labAssistAllowed(configFor({ apiKey: null }))).toBe(false);
    expect(labAssistAllowed(buildAnalystConfig(null, env({})))).toBe(false);
  });
});

describe('resolving the analyst from the stored settings', () => {
  it('uses the Analyst choice, and the demo when there is none', async () => {
    const settings = aiSettingsFor({ analyst: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: null } });
    expect((await resolveAnalystConfig({ aiSettings: settings, env: env({}) })).model).toBe('local');
    const summaryOnly = aiSettingsFor({ summary: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: null } });
    expect((await resolveAnalystConfig({ aiSettings: summaryOnly, env: env({}) })).provider).toBe('demo');
  });

  it('states why when the settings could not be read, and sends nothing', async () => {
    const config = await resolveAnalystConfig({ aiSettings: { providers: [], assignments: [], unavailable: 'The AI settings could not be read from the database.' }, env: env({}) });
    expect(config.provider).toBe('demo');
    expect(config.misconfiguredReason).toContain('could not be read');
  });

  it('reads nothing and is the demo with no database', async () => {
    const config = await resolveAnalystConfig({ aiClient: null, env: env({}) });
    expect(config.provider).toBe('demo');
    expect(config.misconfiguredReason).toBeNull();
  });
});

describe('system prompt precedence: file > inline > built-in (SPEC §8)', () => {
  it('uses the built-in prompt by default', () => {
    const config = buildAnalystConfig(null, env({}));
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPrompt).toContain('never diagnose');
  });

  it('uses the inline prompt when set', () => {
    const config = buildAnalystConfig(null, env({ ANALYST_SYSTEM_PROMPT: 'Answer as a laconic intern.' }));
    expect(config.systemPromptSource).toBe('custom');
    expect(config.systemPrompt).toBe('Answer as a laconic intern.');
  });

  it('lets the file win over the inline prompt, and re-reads it when it changes', () => {
    clearPromptFileCache();
    const dir = tempDir();
    const file = path.join(dir, 'prompt.md');
    writeFileSync(file, 'FILE PROMPT ONE');
    const envWith = env({
      ANALYST_SYSTEM_PROMPT: 'inline prompt',
      ANALYST_SYSTEM_PROMPT_FILE: file,
    });

    const first = buildAnalystConfig(null, envWith);
    expect(first.systemPromptSource).toBe('custom');
    expect(first.systemPrompt).toBe('FILE PROMPT ONE');
    expect(first.systemPromptFile).toBe(file);
    expect(first.systemPromptWarning).toBeNull();

    // Rewrite and move the mtime forward so the cache is invalidated.
    writeFileSync(file, 'FILE PROMPT TWO');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    const second = buildAnalystConfig(null, envWith);
    expect(second.systemPrompt).toBe('FILE PROMPT TWO');
  });

  it('falls back with a stated warning when the prompt file cannot be read', () => {
    clearPromptFileCache();
    const missing = path.join(tempDir(), 'nope.md');
    const config = configFor({}, env({ ANALYST_SYSTEM_PROMPT_FILE: missing }));
    expect(config.systemPrompt).toBe(DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPromptWarning).toContain(missing);
    // A missing prompt file does not make the provider unusable.
    expect(config.misconfiguredReason).toBeNull();

    const withInline = buildAnalystConfig(
      null,
      env({ ANALYST_SYSTEM_PROMPT_FILE: missing, ANALYST_SYSTEM_PROMPT: 'inline fallback' })
    );
    expect(withInline.systemPrompt).toBe('inline fallback');
    expect(withInline.systemPromptSource).toBe('custom');
    expect(withInline.systemPromptWarning).toContain(missing);
  });

  it('keeps the supported demo question list intact', () => {
    expect(SUPPORTED_PROMPTS.length).toBeGreaterThanOrEqual(8);
  });
});
