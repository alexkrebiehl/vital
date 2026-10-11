// ── The AI providers card and the AI models helpers ─────────────────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiProvidersView, type AiProvidersViewProps } from './AiProvidersView';
import { canSaveDraft, draftFor, emptyDraft, isLocalAddress, saveAiProvider, type AiProviderStatus } from './ai-providers-card';
import { canSaveUse, draftFromStatus, fieldProblem, OPTION_FIELDS, optionsToSend, saveUse } from './ai-models-card';

const noop = () => {};
const STORED: AiProviderStatus = {
  id: 'p1',
  name: 'OpenRouter',
  kind: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  host: 'openrouter.ai',
  loopback: false,
  hasKey: true,
  keyLast4: 'ab12',
  needsReentry: false,
  usedBy: ['analyst', 'summary'],
  revision: 1,
};

function render(extra: Partial<AiProvidersViewProps> = {}): string {
  const props: AiProvidersViewProps = {
    body: { available: true, database: true, providers: [STORED] },
    loadError: null,
    draft: null,
    stored: null,
    confirmingId: null,
    busy: false,
    actionError: null,
    notice: null,
    onDraftChange: noop,
    onAdd: noop,
    onEdit: noop,
    onCancel: noop,
    onSave: noop,
    onAskRemove: noop,
    onCancelRemove: noop,
    onRemove: noop,
    onRetry: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(AiProvidersView, props));
}

describe('the AI providers card', () => {
  it('lists a provider with its address, the last 4 of its key and what uses it', () => {
    const html = render();
    expect(html).toContain('OpenRouter');
    expect(html).toContain('https://openrouter.ai/api/v1');
    expect(html).toContain('••••••••ab12');
    expect(html).toContain('Used by Analyst, Summary');
    expect(html).toContain('Add provider');
  });

  it('warns that removing a provider in use leaves those features without a model', () => {
    const html = render({ confirmingId: 'p1' });
    expect(html).toContain('the Analyst, Summary will have no model');
    expect(html).toContain('Yes, remove');
  });

  it('opens an empty form for a new provider, with the key as a password field', () => {
    const html = render({ body: { available: true, database: true, providers: [] }, draft: emptyDraft() });
    expect(html).toContain('aria-label="Add an AI provider"');
    expect(html).toContain('type="password"');
    expect(html).toContain('new-password');
    expect(html).not.toContain('Add provider');
  });

  it('never puts a stored key into the form', () => {
    const html = render({ draft: draftFor(STORED), stored: STORED });
    expect(html).toContain('Leave blank to keep the stored key');
    expect(html).not.toMatch(/value="[^"]*ab12/);
  });

  it('explains the missing secret key and the missing database', () => {
    expect(render({ body: { available: false, database: true, providers: [] } })).toContain('VITAL_SECRET_KEY');
    expect(render({ body: { available: true, database: false, providers: [] } })).toContain('none is configured');
  });

  it('marks a key that must be entered again', () => {
    expect(render({ body: { available: true, database: true, providers: [{ ...STORED, needsReentry: true, keyLast4: null }] } })).toContain(
      'Key needs re-entry'
    );
  });
});

describe('when a provider can be saved', () => {
  it('needs a name and an address, and a key off this machine unless one is stored', () => {
    const draft = { ...emptyDraft(), name: 'X', baseUrl: 'https://api.openai.com/v1' };
    expect(canSaveDraft({ ...draft, name: '' }, null, true)).toBe(false);
    expect(canSaveDraft(draft, null, true)).toBe(false);
    expect(canSaveDraft({ ...draft, apiKey: 'k' }, null, true)).toBe(true);
    expect(canSaveDraft({ ...draft, apiKey: 'k' }, null, false)).toBe(false);
    expect(canSaveDraft({ ...draftFor(STORED) }, STORED, true)).toBe(true);
    expect(canSaveDraft({ ...draft, baseUrl: 'http://host.docker.internal:1234/v1' }, null, false)).toBe(true);
  });

  it('knows which addresses are on this machine', () => {
    expect(isLocalAddress('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalAddress('https://openrouter.ai/api/v1')).toBe(false);
    expect(isLocalAddress('not a url')).toBe(false);
  });

  it('leaves a blank key out, so the stored one is kept', async () => {
    let sent: { url: string; method?: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, method: init.method, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ available: true, database: true, providers: [], models: ['m'] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await saveAiProvider({ ...draftFor(STORED), apiKey: '  ' }, fetchImpl);
    expect(result.ok).toBe(true);
    expect(sent!.url).toBe('/api/ai/providers/p1');
    expect(sent!.method).toBe('PUT');
    expect(sent!.body).toEqual({ name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' });
  });
});

describe('the AI models form', () => {
  it('turns a stored choice into fields and back, sending only what was filled in', () => {
    const draft = draftFromStatus({ providerId: 'p1', model: 'm', options: { maxTokens: 3000, labAssist: false }, revision: 4 });
    expect(draft).toEqual({ providerId: 'p1', model: 'm', options: { maxTokens: '3000' }, labAssist: false, revision: 4 });
    expect(optionsToSend('analyst', { ...draft, options: { ...draft.options, temperature: ' ', context: 'ondemand' } })).toEqual({
      maxTokens: 3000,
      context: 'ondemand',
      labAssist: false,
    });
    expect(optionsToSend('summary', { ...draft, options: { maxTokens: '5000', context: 'ondemand' } })).toEqual({ maxTokens: 5000 });
    expect(draftFromStatus(null)).toEqual({ providerId: '', model: '', options: {}, labAssist: true, revision: 0 });
  });

  it('flags a number out of range and blocks Save until it is fixed', () => {
    const tokens = OPTION_FIELDS.analyst.find(f => f.key === 'maxTokens')!;
    expect(fieldProblem(tokens, '0')).toMatch(/Between/);
    expect(fieldProblem(tokens, '1.5')).toMatch(/whole number/);
    expect(fieldProblem(tokens, '')).toBeNull();
    const base = { providerId: 'p1', model: 'm', options: {}, labAssist: true, revision: 0 };
    expect(canSaveUse('analyst', base)).toBe(true);
    expect(canSaveUse('analyst', { ...base, model: '' })).toBe(false);
    expect(canSaveUse('analyst', { ...base, options: { maxTokens: '-3' } })).toBe(false);
    expect(canSaveUse('analyst', { ...base, providerId: '', model: '' })).toBe(true);
  });

  it('sends a cleared choice as no provider, and hands back the current one on a conflict', async () => {
    let body: Record<string, unknown> = {};
    const conflict = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ error: 'changed elsewhere', current: null }), { status: 409 });
    }) as unknown as typeof fetch;
    const result = await saveUse('summary', { providerId: '', model: '', options: {}, labAssist: true, revision: 2 }, conflict);
    expect(body).toEqual({ use: 'summary', providerId: null, revision: 2 });
    expect(result).toEqual({ ok: false, message: 'changed elsewhere', current: null });
  });
});
