// ── The Health Auto Export card: one test per state, rendered to static markup ─

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  HAE_KEY_COMMANDS,
  HaeConnectionView,
  canSaveHae,
  haeCardState,
  maskedKey,
  saveHae,
  type HaeConnectionViewProps,
  type HaeStatusView,
} from './HaeConnection';

const noop = () => {};
const SAMPLE_ENDPOINT = 'https://sample.invalid:3001';
const BASE: HaeStatusView = {
  available: true,
  configured: false,
  endpoint: null,
  keyLast4: null,
  needsReentry: false,
  lastError: null,
};
const CONNECTED: Partial<HaeStatusView> = { configured: true, endpoint: SAMPLE_ENDPOINT, keyLast4: 'ab12' };

function render(status: Partial<HaeStatusView> | null, extra: Partial<HaeConnectionViewProps> = {}): string {
  const props: HaeConnectionViewProps = {
    status: status ? { ...BASE, ...status } : null,
    loadError: null,
    editing: false,
    endpoint: '',
    apiKey: '',
    confirming: false,
    busy: false,
    actionError: null,
    onEndpointChange: noop,
    onApiKeyChange: noop,
    onSave: noop,
    onAskChange: noop,
    onCancelChange: noop,
    onAskDisconnect: noop,
    onCancelDisconnect: noop,
    onDisconnect: noop,
    onRetry: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(HaeConnectionView, props));
}

describe('HAE card states', () => {
  it('Not available: says how to create the secret key and disables the form', () => {
    const html = render({ available: false });
    expect(html).toContain('data-state="not_available"');
    expect(html).toContain('Not available');
    for (const command of HAE_KEY_COMMANDS) expect(html).toContain(command);
    expect(html).toContain('VITAL_SECRET_KEY');
    expect(html).toMatch(/<input[^>]*\sdisabled=""/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Save/);
  });

  it('Not connected: an address field, a password key field and Save', () => {
    const html = render({});
    expect(html).toContain('data-state="not_connected"');
    expect(html).toContain('Not connected');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('Save');
    expect(html).not.toContain('Disconnect');
    expect(html).not.toMatch(/<input[^>]*\sdisabled=""/);
  });

  it('Connected: shows the address and the key masked to its last 4, with Change and Disconnect', () => {
    const html = render(CONNECTED);
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('Connected');
    expect(html).toContain(SAMPLE_ENDPOINT);
    expect(html).toContain('••••••••ab12');
    expect(html).toContain('Change');
    expect(html).toContain('Disconnect');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('Yes, disconnect');
  });

  it('Change: a blank key keeps the stored one, and the field is never pre-filled with it', () => {
    const html = render(CONNECTED, { editing: true, endpoint: SAMPLE_ENDPOINT });
    expect(html).toContain('type="password"');
    expect(html).toContain('Leave blank to keep the stored key');
    expect(html).toContain(`value="${SAMPLE_ENDPOINT}"`);
    expect(html).toMatch(/type="password"[^>]*value=""/);
    expect(html).not.toMatch(/value="[^"]*ab12/);
    expect(html).toContain('Cancel');
  });

  it('Disconnect asks for a confirm first', () => {
    const html = render(CONNECTED, { confirming: true });
    expect(html).toContain('Yes, disconnect');
    expect(html).toContain('Keep it');
    expect(html).toContain('Confirm disconnect');
    expect(render(CONNECTED, { confirming: true, busy: true })).toContain('Disconnecting…');
  });

  it('Needs re-entry: says so and asks for the address and key again', () => {
    const html = render({ configured: true, needsReentry: true });
    expect(html).toContain('data-state="needs_reentry"');
    expect(html).toContain('Needs re-entry');
    expect(html).toContain('type="password"');
    expect(html).toContain('written under a different secret key');
  });

  it('Error: shows the last failure message beside the stored connection', () => {
    const html = render({ ...CONNECTED, lastError: { kind: 'unauthorised', message: 'The server refused the API key.' } });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('The server refused the API key.');
    expect(html).toContain('Change');
    expect(html).toContain('Disconnect');
  });

  it('shows the real server message after a failed save, and progress while saving', () => {
    expect(render({}, { actionError: 'The server refused the API key.' })).toContain('The server refused the API key.');
    expect(render({}, { busy: true, endpoint: SAMPLE_ENDPOINT, apiKey: 'x' })).toContain('Saving…');
  });

  it('shows a read failure instead of guessing a state', () => {
    const html = render(null, { loadError: 'The status endpoint answered HTTP 500.' });
    expect(html).toContain('could not be read');
    expect(html).toContain('HTTP 500');
    expect(html).not.toContain('Not connected');
  });

  it('shows a loading state before the status arrives', () => {
    expect(render(null)).toContain('Checking the connection');
  });
});

describe('HAE card logic', () => {
  it('picks one state: not available, then re-entry, then error, then connected', () => {
    expect(haeCardState({ ...BASE, available: false, configured: true })).toBe('not_available');
    expect(haeCardState({ ...BASE, configured: true, needsReentry: true })).toBe('needs_reentry');
    expect(haeCardState({ ...CONNECTED, ...BASE, configured: true, lastError: { kind: 'x', message: 'm' } })).toBe('error');
    expect(haeCardState({ ...BASE, configured: true })).toBe('connected');
    expect(haeCardState(BASE)).toBe('not_connected');
  });

  it('masks to eight bullets and the last 4, or to bullets alone when there are none', () => {
    expect(maskedKey('ab12')).toBe('••••••••ab12');
    expect(maskedKey(null)).toBe('••••••••');
  });

  it('can save once there is an address and a key, or an address alone when a key is stored', () => {
    const stored = { ...BASE, ...CONNECTED } as HaeStatusView;
    expect(canSaveHae(BASE, false, '', '')).toBe(false);
    expect(canSaveHae(BASE, false, SAMPLE_ENDPOINT, '')).toBe(false);
    expect(canSaveHae(BASE, false, SAMPLE_ENDPOINT, 'k')).toBe(true);
    expect(canSaveHae(stored, true, SAMPLE_ENDPOINT, '')).toBe(true);
    expect(canSaveHae(stored, true, '  ', '')).toBe(false);
    expect(canSaveHae({ ...BASE, available: false }, false, SAMPLE_ENDPOINT, 'k')).toBe(false);
    expect(canSaveHae({ ...BASE, configured: true, needsReentry: true }, true, SAMPLE_ENDPOINT, '')).toBe(false);
  });
});

describe('saveHae', () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('PUTs the address and key, and returns the new status', async () => {
    const fetchImpl = vi.fn(async () => json({ ...BASE, ...CONNECTED }, 200));
    const result = await saveHae(SAMPLE_ENDPOINT, 'sample-key-ab12', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, status: { ...BASE, ...CONNECTED } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sources/hae');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: SAMPLE_ENDPOINT, apiKey: 'sample-key-ab12' });
  });

  it('omits the key when it is blank, so the stored one is kept', async () => {
    const fetchImpl = vi.fn(async () => json({ ...BASE, ...CONNECTED }, 200));
    await saveHae(SAMPLE_ENDPOINT, '   ', fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: SAMPLE_ENDPOINT });
  });

  it("returns the server's own message for a 422 and for a 503, never the key", async () => {
    for (const [status, error] of [
      [422, 'The server refused the API key.'],
      [503, 'The server has no usable secret key, so the connection cannot be stored.'],
    ] as const) {
      const fetchImpl = async () => json({ error }, status);
      const result = await saveHae(SAMPLE_ENDPOINT, 'sample-key-ab12', fetchImpl as unknown as typeof fetch);
      expect(result).toEqual({ ok: false, message: error });
      expect(JSON.stringify(result)).not.toContain('sample-key-ab12');
    }
  });

  it('falls back to the HTTP status when the answer has no message, and when the network fails', async () => {
    const noBody = async () => new Response('<html>', { status: 502 });
    expect(await saveHae(SAMPLE_ENDPOINT, 'k', noBody as unknown as typeof fetch)).toEqual({
      ok: false,
      message: 'The connection could not be saved (HTTP 502).',
    });
    const down = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const result = await saveHae(SAMPLE_ENDPOINT, 'k', down as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, message: 'The connection could not be saved: Vital could not be reached.' });
  });
});

describe('nextStepAfterChange', () => {
  it('opens the app after the first save, and refreshes in every other case', async () => {
    const { nextStepAfterChange } = await import('./hae-card');
    expect(nextStepAfterChange('saved', true)).toBe('open-app');
    expect(nextStepAfterChange('saved', false)).toBe('refresh');
    expect(nextStepAfterChange('disconnected', true)).toBe('refresh');
    expect(nextStepAfterChange('disconnected', false)).toBe('refresh');
  });
});
