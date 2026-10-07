// ── The Hevy card: one test per state, rendered to static markup ────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  HevyConnectionView,
  canSaveHevy,
  hevyCardState,
  maskedKey,
  saveHevy,
  type HevyConnectionViewProps,
  type HevyStatusView,
} from './HevyConnection';

const noop = () => {};
const SAMPLE_URL = 'https://hevy-sample.invalid';
const BASE: HevyStatusView = {
  available: true,
  configured: false,
  url: null,
  keyLast4: null,
  needsReentry: false,
  lastError: null,
};
const CONNECTED: Partial<HevyStatusView> = { configured: true, keyLast4: 'ab12' };

function render(status: Partial<HevyStatusView> | null, extra: Partial<HevyConnectionViewProps> = {}): string {
  const props: HevyConnectionViewProps = {
    status: status ? { ...BASE, ...status } : null,
    loadError: null,
    editing: false,
    url: '',
    apiKey: '',
    confirming: false,
    busy: false,
    actionError: null,
    onUrlChange: noop,
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
  return renderToStaticMarkup(createElement(HevyConnectionView, props));
}

describe('Hevy card states', () => {
  it('Not available: says how to create the secret key and disables the form', () => {
    const html = render({ available: false });
    expect(html).toContain('data-state="not_available"');
    expect(html).toContain('Not available');
    expect(html).toContain('VITAL_SECRET_KEY');
    expect(html).toContain('npm run db:init');
    expect(html).toMatch(/<input[^>]*\sdisabled=""/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Save/);
  });

  it('Not connected: a password key field, an optional address field and Save', () => {
    const html = render({});
    expect(html).toContain('data-state="not_connected"');
    expect(html).toContain('Not connected');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('API address (optional)');
    expect(html).toContain("Leave blank to use Hevy&#x27;s own API");
    expect(html).toContain('Save');
    expect(html).not.toContain('Disconnect');
    expect(html).not.toMatch(/<input[^>]*\sdisabled=""/);
  });

  it('Connected: shows the key masked to its last 4 and the default address, with Change and Disconnect', () => {
    const html = render(CONNECTED);
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('Connected');
    expect(html).toContain('••••••••ab12');
    expect(html).toContain('Hevy&#x27;s own API');
    expect(html).toContain('Change');
    expect(html).toContain('Disconnect');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('Yes, disconnect');
  });

  it('Connected with a custom address shows it', () => {
    expect(render({ ...CONNECTED, url: SAMPLE_URL })).toContain(SAMPLE_URL);
  });

  it('Change: a blank key keeps the stored one, and the field is never pre-filled with it', () => {
    const html = render({ ...CONNECTED, url: SAMPLE_URL }, { editing: true, url: SAMPLE_URL });
    expect(html).toContain('type="password"');
    expect(html).toContain('Leave blank to keep the stored key');
    expect(html).toContain(`value="${SAMPLE_URL}"`);
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

  it('Needs re-entry: says so and asks for the key again', () => {
    const html = render({ configured: true, needsReentry: true });
    expect(html).toContain('data-state="needs_reentry"');
    expect(html).toContain('Needs re-entry');
    expect(html).toContain('type="password"');
    expect(html).toContain('written under a different secret key');
    expect(html).toContain('Paste the API key');
  });

  it('Error: shows the last failure message beside the stored connection', () => {
    const html = render({ ...CONNECTED, lastError: { kind: 'sync_failed', message: 'Hevy answered HTTP 500 for /v1/workouts.' } });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('Hevy answered HTTP 500');
    expect(html).toContain('Change');
    expect(html).toContain('Disconnect');
  });

  it('shows the real server message after a failed save, and progress while saving', () => {
    expect(render({}, { actionError: 'The server refused the API key.' })).toContain('The server refused the API key.');
    expect(render({}, { busy: true, apiKey: 'sample-key' })).toContain('Saving…');
  });

  it('never puts a typed key in the markup of a stored connection', () => {
    expect(render(CONNECTED)).not.toContain('sample-key');
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

describe('Hevy card logic', () => {
  it('picks one state: not available, then re-entry, then error, then connected', () => {
    expect(hevyCardState({ ...BASE, available: false, configured: true })).toBe('not_available');
    expect(hevyCardState({ ...BASE, configured: true, needsReentry: true })).toBe('needs_reentry');
    expect(hevyCardState({ ...BASE, configured: true, lastError: { kind: 'x', message: 'm' } })).toBe('error');
    expect(hevyCardState({ ...BASE, configured: true })).toBe('connected');
    expect(hevyCardState(BASE)).toBe('not_connected');
  });

  it('masks to eight bullets and the last 4, or to bullets alone when there are none', () => {
    expect(maskedKey('ab12')).toBe('••••••••ab12');
    expect(maskedKey(null)).toBe('••••••••');
  });

  it('can save with a key alone (the address is optional), or with no key when one is stored', () => {
    const stored = { ...BASE, ...CONNECTED } as HevyStatusView;
    expect(canSaveHevy(BASE, false, '')).toBe(false);
    expect(canSaveHevy(BASE, false, '  ')).toBe(false);
    expect(canSaveHevy(BASE, false, 'k')).toBe(true);
    expect(canSaveHevy(stored, true, '')).toBe(true);
    expect(canSaveHevy(stored, false, '')).toBe(false);
    expect(canSaveHevy({ ...BASE, available: false }, false, 'k')).toBe(false);
    expect(canSaveHevy({ ...BASE, configured: true, needsReentry: true }, true, '')).toBe(false);
  });
});

describe('saveHevy', () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('PUTs the key and address, and returns the new status', async () => {
    const fetchImpl = vi.fn(async () => json({ ...BASE, ...CONNECTED }, 200));
    const result = await saveHevy(` ${SAMPLE_URL} `, 'sample-key-ab12', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, status: { ...BASE, ...CONNECTED } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sources/hevy');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ url: SAMPLE_URL, apiKey: 'sample-key-ab12' });
  });

  it('omits the key when it is blank, so the stored one is kept, and always sends the address', async () => {
    const fetchImpl = vi.fn(async () => json({ ...BASE, ...CONNECTED }, 200));
    await saveHevy('', '   ', fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ url: '' });
  });

  it("returns the server's own message for a 422 and for a 503, never the key", async () => {
    for (const [status, error] of [
      [422, 'The server refused the API key.'],
      [503, 'The server has no usable secret key, so the connection cannot be stored.'],
    ] as const) {
      const fetchImpl = async () => json({ error }, status);
      const result = await saveHevy('', 'sample-key-ab12', fetchImpl as unknown as typeof fetch);
      expect(result).toEqual({ ok: false, message: error });
      expect(JSON.stringify(result)).not.toContain('sample-key-ab12');
    }
  });

  it('falls back to the HTTP status when the answer has no message, and when the network fails', async () => {
    const noBody = async () => new Response('<html>', { status: 502 });
    expect(await saveHevy('', 'k', noBody as unknown as typeof fetch)).toEqual({
      ok: false,
      message: 'The connection could not be saved (HTTP 502).',
    });
    const down = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect(await saveHevy('', 'k', down as unknown as typeof fetch)).toEqual({
      ok: false,
      message: 'The connection could not be saved: Vital could not be reached.',
    });
  });
});
