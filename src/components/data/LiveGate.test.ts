import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate reads the path, the router and the query from Next. Static rendering has no
// router, so these stand in for it; each test sets the path it is "on".
const nav = vi.hoisted(() => ({ pathname: '/', tab: null as string | null, replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.tab ? { tab: nav.tab } : {}),
}));

import { LiveGate, isSettingsPath, setupRedirectTarget, showsConnectionError } from './LiveGate';
import { useSetupFailure } from './setup-mode';

const FAILURE = { title: 'No source is connected', message: 'Nothing can be read yet.', host: null, hint: 'Connect one.' };

describe('showsConnectionError', () => {
  it('is true for data pages and for an unknown path', () => {
    for (const p of ['/', '/sleep', '/activity', '/analyst', null]) expect(showsConnectionError(p)).toBe(true);
  });
  it('is false for Settings, where a source is connected', () => {
    for (const p of ['/settings', '/settings/']) expect(showsConnectionError(p)).toBe(false);
    expect(isSettingsPath('/settings')).toBe(true);
  });
  it('does not treat look-alike paths as Settings', () => {
    for (const p of ['/settingsx', '/settings-old', '/x/settings', '/settingsx/connections']) {
      expect(showsConnectionError(p)).toBe(true);
    }
  });
});

describe('setupRedirectTarget', () => {
  const TARGET = '/settings?tab=sources';
  it('sends every other page to Settings → Sources', () => {
    for (const p of ['/', '/sleep', '/settingsx', '/analyst', null]) expect(setupRedirectTarget(p, null)).toBe(TARGET);
  });
  it('sends Settings without a tab to Sources', () => {
    expect(setupRedirectTarget('/settings', null)).toBe(TARGET);
    expect(setupRedirectTarget('/settings', '')).toBe(TARGET);
    expect(setupRedirectTarget('/settings/', null)).toBe(TARGET);
  });
  it('leaves Settings alone when it already names a tab', () => {
    expect(setupRedirectTarget('/settings', 'sources')).toBeNull();
    expect(setupRedirectTarget('/settings', 'account')).toBeNull();
  });
});

function Probe() {
  return createElement('p', null, `failure:${useSetupFailure()?.title ?? 'none'}`);
}
const gate = (failure: typeof FAILURE | null) =>
  renderToStaticMarkup(
    createElement(
      LiveGate,
      { failure } as ComponentProps<typeof LiveGate>,
      createElement('span', null, 'PAGE'),
      createElement(Probe)
    )
  );

describe('LiveGate', () => {
  beforeEach(() => {
    nav.pathname = '/';
    nav.tab = null;
    nav.replace.mockClear();
  });

  it('demo mode and a working live setup are unchanged: no failure, the page renders everywhere', () => {
    for (const p of ['/', '/sleep', '/settings']) {
      nav.pathname = p;
      const html = gate(null);
      expect(html).toContain('PAGE');
      expect(html).toContain('failure:none');
    }
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('in setup mode a data page renders nothing, so its content never flashes', () => {
    nav.pathname = '/sleep';
    expect(gate(FAILURE)).not.toContain('PAGE');
    nav.pathname = '/settingsx';
    expect(gate(FAILURE)).not.toContain('PAGE');
  });

  it('in setup mode Settings without a tab renders nothing until it is redirected', () => {
    nav.pathname = '/settings';
    expect(gate(FAILURE)).not.toContain('PAGE');
  });

  it('in setup mode Settings on a tab renders, and the failure is available to it', () => {
    nav.pathname = '/settings';
    nav.tab = 'sources';
    const html = gate(FAILURE);
    expect(html).toContain('PAGE');
    expect(html).toContain('failure:No source is connected');
  });
});
