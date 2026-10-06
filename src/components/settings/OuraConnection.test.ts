// ── The Oura card: one test per state, rendered to static markup ─────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OURA_AUTHORIZE_PATH,
  OURA_ENV_VARS,
  OuraConnectionView,
  noticeFrom,
  ouraCardState,
  type OuraConnectionViewProps,
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

function render(status: Partial<OuraStatusView> | null, extra: Partial<OuraConnectionViewProps> = {}): string {
  const props: OuraConnectionViewProps = {
    status: status ? { ...BASE_STATUS, ...status } : null,
    loadError: null,
    notice: null,
    confirming: false,
    busy: false,
    actionError: null,
    onAskDisconnect: noop,
    onCancelDisconnect: noop,
    onDisconnect: noop,
    onRetry: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(OuraConnectionView, props));
}

describe('Oura card states', () => {
  it('Not configured: lists the environment variable names and offers no button', () => {
    const html = render({ configured: false });
    expect(html).toContain('data-state="not_configured"');
    expect(html).toContain('Not configured');
    for (const name of OURA_ENV_VARS) expect(html).toContain(name);
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
    expect(html).not.toContain('Disconnect');
  });

  it('Not configured: says which variable is wrong when the setup is partial', () => {
    expect(render({ configured: false, configProblem: 'OURA_CLIENT_SECRET is not set.' })).toContain(
      'OURA_CLIENT_SECRET is not set.'
    );
  });

  it('Ready to connect: a Connect button that links to the authorize route', () => {
    const html = render({});
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('Ready to connect');
    expect(html).toContain(`href="${OURA_AUTHORIZE_PATH}"`);
    expect(html).toContain('Connect Oura');
    expect(html).not.toContain('Disconnect');
  });

  it('Connected: shows the granted scopes, the missing ones in plain words, and Disconnect', () => {
    const html = render({ connected: true, scopes: ['daily', 'spo2'], missingScopes: ['heartrate', 'workout'] });
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('Connected');
    expect(html).toContain('Allowed: daily summaries (sleep, activity, readiness), blood oxygen.');
    expect(html).toContain('Not allowed: heart rate, workouts.');
    expect(html).toContain('Disconnect');
    expect(html).not.toContain('Yes, disconnect');
    expect(html).not.toContain(OURA_AUTHORIZE_PATH);
  });

  it('Connected with everything allowed: says nothing is missing by saying nothing', () => {
    const html = render({ connected: true, scopes: ['daily', 'heartrate', 'workout', 'spo2'] });
    expect(html).not.toContain('Not allowed');
  });

  it('Disconnect asks for a confirm before it does anything', () => {
    const html = render({ connected: true, scopes: ['daily'] }, { confirming: true });
    expect(html).toContain('Yes, disconnect');
    expect(html).toContain('Keep it');
    expect(html).toContain('Confirm disconnect');
    expect(render({ connected: true, scopes: ['daily'] }, { confirming: true, busy: true })).toContain('Disconnecting…');
  });

  it('Needs reconnect: says so and offers Reconnect', () => {
    const html = render({ needsReconnect: true });
    expect(html).toContain('data-state="needs_reconnect"');
    expect(html).toContain('Needs reconnect');
    expect(html).toContain(`href="${OURA_AUTHORIZE_PATH}"`);
    expect(html).toContain('Reconnect Oura');
  });

  it('Error: shows the last error message', () => {
    const html = render({
      connected: true,
      scopes: ['daily'],
      lastError: { kind: 'forbidden', message: "Oura denied access: a scope wasn't granted or the membership has lapsed." },
    });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('Error');
    expect(html).toContain('Oura denied access: a scope wasn&#x27;t granted or the membership has lapsed.');
    expect(html).toContain('Disconnect');
  });

  it('shows a one-line notice after the redirect back from Oura', () => {
    expect(render({ connected: true, scopes: ['daily'] }, { notice: 'connected' })).toContain('Oura is connected.');
    expect(render({}, { notice: 'denied' })).toContain('The Oura sign-in was cancelled, so nothing was connected.');
    expect(render({})).not.toContain('role="status"');
  });

  it('shows a read failure instead of guessing a state', () => {
    const html = render(null, { loadError: 'The status endpoint answered HTTP 500.' });
    expect(html).toContain('The Oura status could not be read');
    expect(html).toContain('HTTP 500');
    expect(html).not.toContain('Ready to connect');
  });

  it('shows a loading state before the status arrives', () => {
    expect(render(null)).toContain('Checking the Oura connection');
  });
});

describe('Oura card logic', () => {
  it('picks one state, needs-reconnect before error before connected', () => {
    expect(ouraCardState({ ...BASE_STATUS, configured: false })).toBe('not_configured');
    expect(ouraCardState({ ...BASE_STATUS, needsReconnect: true, lastError: { kind: 'x', message: 'm' } })).toBe('needs_reconnect');
    expect(ouraCardState({ ...BASE_STATUS, connected: true, lastError: { kind: 'x', message: 'm' } })).toBe('error');
    expect(ouraCardState({ ...BASE_STATUS, connected: true })).toBe('connected');
    expect(ouraCardState(BASE_STATUS)).toBe('ready');
  });

  it('reads only the two known values of ?oura=', () => {
    expect(noticeFrom('connected')).toBe('connected');
    expect(noticeFrom('denied')).toBe('denied');
    expect(noticeFrom('<script>')).toBeNull();
    expect(noticeFrom(null)).toBeNull();
  });
});

describe('Settings is the only page that names a data source', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const SETTINGS_PAGE = path.join(ROOT, 'app/settings/page.tsx');
  const ALLOWED_OURA = new Set([path.join(ROOT, 'components/settings/OuraConnection.tsx'), SETTINGS_PAGE]);
  const ALLOWED_HAE = new Set(
    ['HaeConnection.tsx', 'HaeConnectionView.tsx', 'hae-card.ts'].map(name => path.join(ROOT, 'components/settings', name)).concat(SETTINGS_PAGE)
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

  it('actually reads the comments off, so the guard is not blind (a mention in a comment passes, in text it fails)', () => {
    expect(/Health Auto Export/.test(withoutComments('// Health Auto Export\n/* HAE */ const a = 1;'))).toBe(false);
    expect(/Health Auto Export/.test(withoutComments("const a = 'Health Auto Export';"))).toBe(true);
    expect(/Health Auto Export/.test(withoutComments('<p>Health Auto Export</p>'))).toBe(true);
  });
});

