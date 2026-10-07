// ── The Oura card: one test per state, rendered to static markup ─────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OURA_APP_PATH,
  OURA_AUTHORIZE_PATH,
  OURA_KEY_COMMANDS,
  OuraConnectionView,
  canSaveOuraApp,
  defaultRedirectUri,
  noticeFrom,
  ouraCardState,
  saveOuraApp,
  type OuraAppView,
  type OuraConnectionViewProps,
  type OuraFormValues,
  type OuraStatusView,
} from './OuraConnection';

const noop = () => {};
const BASE_STATUS: OuraStatusView = {
  configured: true,
  configProblem: null,
  connected: false,
  scopes: [],
  missingScopes: [],
  accessExpiresAt: null,
  needsReconnect: false,
  lastError: null,
};
const BASE_APP: OuraAppView = {
  available: true,
  configured: true,
  clientId: 'sample-client',
  secretLast4: '1234',
  redirectUri: 'http://localhost:8080/api/sources/oura/callback',
  needsReentry: false,
};
const NO_APP: OuraAppView = { ...BASE_APP, configured: false, clientId: null, secretLast4: null, redirectUri: null };
const EMPTY_FORM: OuraFormValues = { clientId: '', clientSecret: '', redirectUri: '' };

function render(
  status: Partial<OuraStatusView> | null,
  extra: Partial<OuraConnectionViewProps> = {},
  app: Partial<OuraAppView> | null = {}
): string {
  const props: OuraConnectionViewProps = {
    status: status ? { ...BASE_STATUS, ...status } : null,
    app: app ? { ...BASE_APP, ...app } : null,
    loadError: null,
    notice: null,
    warnings: [],
    editing: false,
    form: EMPTY_FORM,
    confirming: false,
    confirmingRemove: false,
    busy: false,
    actionError: null,
    onFormChange: noop,
    onSave: noop,
    onAskChange: noop,
    onCancelChange: noop,
    onAskDisconnect: noop,
    onCancelDisconnect: noop,
    onDisconnect: noop,
    onAskRemove: noop,
    onCancelRemove: noop,
    onRemove: noop,
    onRetry: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(OuraConnectionView, props));
}

describe('Oura card states', () => {
  it('No secret key: a disabled form and how to create the key', () => {
    const html = render({ configured: false }, {}, { ...NO_APP, available: false });
    expect(html).toContain('data-state="not_available"');
    expect(html).toContain('VITAL_SECRET_KEY');
    for (const command of OURA_KEY_COMMANDS) expect(html).toContain(command);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
  });

  it('App credentials missing: the form, and no Connect button', () => {
    const html = render({ configured: false }, { form: { ...EMPTY_FORM, redirectUri: 'http://localhost:8080/api/sources/oura/callback' } }, NO_APP);
    expect(html).toContain('data-state="app_missing"');
    expect(html).toContain('Not configured');
    expect(html).toContain('Client ID');
    expect(html).toContain('Client secret');
    expect(html).toContain('Redirect URI');
    expect(html).toContain('value="http://localhost:8080/api/sources/oura/callback"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Save');
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
    expect(html).not.toContain('Disconnect');
    expect(html).not.toContain('OURA_CLIENT_ID');
  });

  it('the form says the redirect URI must match the one registered with Oura, and that http is for localhost only', () => {
    const html = render({ configured: false }, {}, NO_APP);
    expect(html).toContain('exactly');
    expect(html).toContain('registered');
    expect(html).toContain('plain http');
    expect(html).toContain('localhost');
  });

  it('the secret field never carries a value from the server, only what is typed', () => {
    const stored = render({}, { editing: true, form: { clientId: 'sample-client', clientSecret: '', redirectUri: BASE_APP.redirectUri! } });
    expect(stored).not.toMatch(/type="password"[^>]*value="[^"]/);
    expect(stored).toContain('Leave blank to keep the stored secret');
    expect(stored).not.toContain('sample-secret');
  });

  it('A saved warning for a non-localhost http address is shown', () => {
    expect(render({}, { warnings: ['Oura accepts a plain http redirect URI only for localhost.'] })).toContain(
      'Oura accepts a plain http redirect URI only for localhost.'
    );
  });

  it('Credentials saved, not connected: Connect, Change and Remove credentials, with the secret masked to its last 4', () => {
    const html = render({});
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('Ready to connect');
    expect(html).toContain(`href="${OURA_AUTHORIZE_PATH}"`);
    expect(html).toContain('Connect Oura');
    expect(html).toContain('sample-client');
    expect(html).toContain('••••••••1234');
    expect(html).toContain('Change');
    expect(html).toContain('Remove credentials');
    expect(html).not.toContain('Disconnect');
  });

  it('Remove credentials asks for a confirm that says it also disconnects Oura', () => {
    const html = render({}, { confirmingRemove: true });
    expect(html).toContain('Yes, remove');
    expect(html).toContain('Keep them');
    expect(html).toContain('Confirm remove');
    expect(html).toMatch(/disconnect/i);
    expect(render({}, { confirmingRemove: true, busy: true })).toContain('Removing…');
  });

  it('Connected: the credentials summary, granted scopes, missing ones in plain words, and Disconnect', () => {
    const html = render({ connected: true, scopes: ['daily', 'spo2'], missingScopes: ['heartrate', 'workout'] });
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('sample-client');
    expect(html).toContain('••••••••1234');
    expect(html).toContain('Allowed: daily summaries (sleep, activity, readiness), blood oxygen.');
    expect(html).toContain('Not allowed: heart rate, workouts.');
    expect(html).toContain('Disconnect');
    expect(html).toContain('Change');
    expect(html).not.toContain('Yes, disconnect');
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
  });

  it('Connected with everything allowed: says nothing is missing by saying nothing', () => {
    expect(render({ connected: true, scopes: ['daily', 'heartrate', 'workout', 'spo2'] })).not.toContain('Not allowed');
  });

  it('Disconnect asks for a confirm before it does anything', () => {
    const html = render({ connected: true, scopes: ['daily'] }, { confirming: true });
    expect(html).toContain('Yes, disconnect');
    expect(html).toContain('Keep it');
    expect(html).toContain('Confirm disconnect');
    expect(render({ connected: true, scopes: ['daily'] }, { confirming: true, busy: true })).toContain('Disconnecting…');
  });

  it('Needs reconnect: says the login no longer matches, keeps it, and offers Reconnect, Change and Remove', () => {
    const html = render({ needsReconnect: true });
    expect(html).toContain('data-state="needs_reconnect"');
    expect(html).toContain('Needs reconnect');
    expect(html).toContain('client ID');
    expect(html).toContain(`href="${OURA_AUTHORIZE_PATH}"`);
    expect(html).toContain('Reconnect Oura');
    expect(html).toContain('Remove credentials');
  });

  it('Stored credentials that cannot be read: the form again, with a plain reason', () => {
    const html = render({ configured: false }, {}, { needsReentry: true, clientId: null, secretLast4: null, redirectUri: null });
    expect(html).toContain('data-state="needs_reentry"');
    expect(html).toContain('Needs re-entry');
    expect(html).toContain('Enter them again');
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
  });

  it('Error: shows the last error message', () => {
    const html = render({
      connected: true,
      scopes: ['daily'],
      lastError: { kind: 'forbidden', message: "Oura denied access: a scope wasn't granted or the membership has lapsed." },
    });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('Oura denied access: a scope wasn&#x27;t granted or the membership has lapsed.');
    expect(html).toContain('Disconnect');
  });

  it('shows a one-line notice after the redirect back from Oura', () => {
    expect(render({ connected: true, scopes: ['daily'] }, { notice: 'connected' })).toContain('Oura is connected.');
    expect(render({}, { notice: 'denied' })).toContain('The Oura sign-in was cancelled, so nothing was connected.');
    expect(render({})).not.toContain('role="status"');
  });

  it('shows a read failure instead of guessing a state', () => {
    const html = render(null, { loadError: 'The status endpoint answered HTTP 500.' }, null);
    expect(html).toContain('The Oura status could not be read');
    expect(html).toContain('HTTP 500');
    expect(html).not.toContain('Ready to connect');
  });

  it('shows a loading state before the status arrives', () => {
    expect(render(null, {}, null)).toContain('Checking the Oura connection');
  });

  it('shows an action error and disables the form while busy', () => {
    const html = render({ configured: false }, { actionError: 'The credentials could not be stored.', busy: true }, NO_APP);
    expect(html).toContain('The credentials could not be stored.');
    expect(html).toContain('Saving…');
  });
});

describe('Oura card logic', () => {
  it('picks one state', () => {
    const st = (over: Partial<OuraStatusView> = {}) => ({ ...BASE_STATUS, ...over });
    expect(ouraCardState(st(), { ...NO_APP, available: false })).toBe('not_available');
    expect(ouraCardState(st({ configured: false }), NO_APP)).toBe('app_missing');
    expect(ouraCardState(st({ configured: false }), { ...BASE_APP, needsReentry: true })).toBe('needs_reentry');
    expect(ouraCardState(st({ needsReconnect: true, lastError: { kind: 'x', message: 'm' } }), BASE_APP)).toBe('needs_reconnect');
    expect(ouraCardState(st({ connected: true, lastError: { kind: 'x', message: 'm' } }), BASE_APP)).toBe('error');
    expect(ouraCardState(st({ connected: true }), BASE_APP)).toBe('connected');
    expect(ouraCardState(st(), BASE_APP)).toBe('ready');
  });

  it('prefills the redirect URI from the address the page is loaded from', () => {
    expect(defaultRedirectUri('http://localhost:8080')).toBe('http://localhost:8080/api/sources/oura/callback');
    expect(defaultRedirectUri('https://vital.example.test')).toBe('https://vital.example.test/api/sources/oura/callback');
  });

  it('can save with all three fields, or with a blank secret only when changing stored credentials', () => {
    const full: OuraFormValues = { clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/cb' };
    expect(canSaveOuraApp(BASE_APP, false, full)).toBe(true);
    expect(canSaveOuraApp(NO_APP, false, { ...full, clientSecret: ' ' })).toBe(false);
    expect(canSaveOuraApp(BASE_APP, true, { ...full, clientSecret: '' })).toBe(true);
    expect(canSaveOuraApp({ ...BASE_APP, needsReentry: true }, true, { ...full, clientSecret: '' })).toBe(false);
    expect(canSaveOuraApp(NO_APP, false, { ...full, clientId: ' ' })).toBe(false);
    expect(canSaveOuraApp(NO_APP, false, { ...full, redirectUri: '' })).toBe(false);
    expect(canSaveOuraApp({ ...NO_APP, available: false }, false, full)).toBe(false);
  });

  it('reads only the two known values of ?oura=', () => {
    expect(noticeFrom('connected')).toBe('connected');
    expect(noticeFrom('denied')).toBe('denied');
    expect(noticeFrom('<script>')).toBeNull();
    expect(noticeFrom(null)).toBeNull();
  });
});

describe('saveOuraApp', () => {
  const values: OuraFormValues = { clientId: ' sample-client ', clientSecret: ' typed-secret ', redirectUri: ' http://localhost:8080/cb ' };

  it('PUTs trimmed values, and leaves a blank secret out of the body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ...BASE_APP, warnings: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await saveOuraApp(values, fetchImpl);
    expect(ok).toMatchObject({ ok: true, warnings: [] });
    expect(calls[0].url).toBe(OURA_APP_PATH);
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      clientId: 'sample-client',
      clientSecret: 'typed-secret',
      redirectUri: 'http://localhost:8080/cb',
    });
    await saveOuraApp({ ...values, clientSecret: '  ' }, fetchImpl);
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty('clientSecret');
  });

  it('never puts the secret in the URL or in what it returns', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ...BASE_APP, warnings: ['w'] }), { status: 200 })) as unknown as typeof fetch;
    const result = await saveOuraApp(values, fetchImpl);
    expect(JSON.stringify(result)).not.toContain('typed-secret');
    expect(OURA_APP_PATH).not.toContain('?');
  });

  it("returns the server's own plain message on a refusal, and a plain one when it cannot be reached", async () => {
    const refuse = (async () => new Response(JSON.stringify({ error: 'The client secret is required.' }), { status: 400 })) as unknown as typeof fetch;
    expect(await saveOuraApp(values, refuse)).toEqual({ ok: false, message: 'The client secret is required.' });
    const down = (async () => {
      throw new Error('typed-secret');
    }) as unknown as typeof fetch;
    const failed = await saveOuraApp(values, down);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('typed-secret');
  });
});

describe('Settings is the only page that names a data source', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const SETTINGS_PAGE = path.join(ROOT, 'app/settings/page.tsx');
  const ALLOWED_OURA = new Set(
    ['OuraConnection.tsx', 'OuraConnectionView.tsx', 'OuraAppForm.tsx', 'oura-card.ts', 'SourcesTab.tsx']
      .map(name => path.join(ROOT, 'components/settings', name))
      .concat(SETTINGS_PAGE)
  );
  const ALLOWED_HAE = new Set(
    ['HaeConnection.tsx', 'HaeConnectionView.tsx', 'hae-card.ts'].map(name => path.join(ROOT, 'components/settings', name)).concat(SETTINGS_PAGE)
  );

  const ALLOWED_HEVY = new Set(
    ['HevyConnection.tsx', 'HevyConnectionView.tsx', 'hevy-card.ts']
      .map(name => path.join(ROOT, 'components/settings', name))
      .concat(SETTINGS_PAGE)
  );

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
    return out;
  }

  const pages = () =>
    [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'app'))].filter(
      file => !file.includes(`${path.sep}api${path.sep}`)
    );

  /** What a reader can see: the code with its comments taken out. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('keeps the name Oura out of every other component and page', () => {
    const offenders = pages()
      .filter(file => !ALLOWED_OURA.has(file))
      .filter(file => /\boura\b/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps the name Health Auto Export out of every other component and page, in text a reader sees', () => {
    const offenders = pages()
      .filter(file => !ALLOWED_HAE.has(file))
      .filter(file => /Health Auto Export|\bHAE\b/.test(withoutComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('keeps the name Hevy out of every other component and page, in text a reader sees', () => {
    const offenders = pages()
      .filter(file => !ALLOWED_HEVY.has(file))
      .filter(file => /\bHevy\b/.test(withoutComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('actually reads the comments off, so the guard is not blind (a mention in a comment passes, in text it fails)', () => {
    expect(/Health Auto Export/.test(withoutComments('// Health Auto Export\n/* HAE */ const a = 1;'))).toBe(false);
    expect(/Health Auto Export/.test(withoutComments("const a = 'Health Auto Export';"))).toBe(true);
    expect(/Health Auto Export/.test(withoutComments('<p>Health Auto Export</p>'))).toBe(true);
  });
});

