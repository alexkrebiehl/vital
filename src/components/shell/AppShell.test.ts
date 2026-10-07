import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/sleep',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell } from './AppShell';
import type { VitalProfile } from '@/lib/profile/types';

const PROFILE = { name: 'Sample Person' } as unknown as VitalProfile;
const shell = (setupMode?: boolean) =>
  renderToStaticMarkup(
    createElement(
      AppShell,
      { profile: PROFILE, profileStored: false, setupMode } as ComponentProps<typeof AppShell>,
      createElement('p', null, 'CONTENT')
    )
  );

describe('AppShell', () => {
  it('normally has the sidebar, mobile navigation, breadcrumbs and the search button', () => {
    for (const html of [shell(), shell(false)]) {
      expect(html).toContain('Main navigation');
      expect(html).toContain('Mobile navigation');
      expect(html).toContain('Breadcrumb');
      expect(html).toContain('Search your health data');
      expect(html).toContain('CONTENT');
    }
  });

  it('in setup mode has no navigation, no breadcrumbs and no search, and keeps the page and the avatar', () => {
    const html = shell(true);
    expect(html).not.toContain('Main navigation');
    expect(html).not.toContain('Mobile navigation');
    expect(html).not.toContain('Breadcrumb');
    expect(html).not.toContain('Search your health data');
    expect(html).not.toContain('<a ');
    expect(html).toContain('CONTENT');
    expect(html).toContain('Signed in as Sample Person');
  });
});
