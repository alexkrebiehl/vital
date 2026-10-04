// ── The "Removed sources" panel: one test per state, rendered to static markup ─

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RemovedSourcesView,
  conversationsPhrase,
  dayOf,
  type RemovedSourcesPayload,
  type RemovedSourcesViewProps,
} from './RemovedSources';

const noop = () => {};
const PAYLOAD: RemovedSourcesPayload = {
  graceDays: 7,
  sources: [
    {
      id: 'oura',
      name: 'Oura Ring',
      removedAt: '2026-10-04T12:00:00.000Z',
      purgeOn: '2026-10-11T12:00:00.000Z',
      hiddenConversations: 2,
    },
  ],
};

function render(extra: Partial<RemovedSourcesViewProps> = {}): string {
  const props: RemovedSourcesViewProps = {
    data: PAYLOAD,
    loadError: null,
    confirmingId: null,
    busyId: null,
    actionError: null,
    onAsk: noop,
    onCancel: noop,
    onDelete: noop,
    onRetry: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(RemovedSourcesView, props));
}

describe('RemovedSourcesView', () => {
  it('lists each removed source with its date, hidden count and purge date', () => {
    const html = render();
    expect(html).toContain('Oura Ring');
    expect(html).toContain('Removed 2026-10-04');
    expect(html).toContain('2 conversations are hidden');
    expect(html).toContain('deleted automatically on 2026-10-11');
    expect(html).toContain('after 7 days');
    expect(html).toContain('Delete now');
  });

  it('asks for confirmation before deleting', () => {
    const html = render({ confirmingId: 'oura' });
    expect(html).toContain('Yes, delete');
    expect(html).toContain('This cannot be undone.');
    expect(html).not.toContain('Delete now');
  });

  it('shows progress while deleting', () => {
    expect(render({ confirmingId: 'oura', busyId: 'oura' })).toContain('Deleting…');
  });

  it('shows a failed deletion', () => {
    expect(render({ actionError: 'The data could not be deleted (HTTP 500).' })).toContain('HTTP 500');
  });

  it('renders nothing when no source was removed', () => {
    expect(render({ data: { graceDays: 7, sources: [] } })).toBe('');
  });

  it('shows a read failure, assuming nothing in its place', () => {
    const html = render({ data: null, loadError: 'The endpoint answered HTTP 500.' });
    expect(html).toContain('could not be read');
    expect(html).toContain('HTTP 500');
  });

  it('shows a loading state', () => {
    expect(render({ data: null })).toContain('Checking for removed sources');
  });
});

describe('helpers', () => {
  it('formats a day and a count', () => {
    expect(dayOf('2026-10-04T23:59:59.000Z')).toBe('2026-10-04');
    expect(conversationsPhrase(0)).toBe('No conversations are hidden');
    expect(conversationsPhrase(1)).toBe('1 conversation is hidden');
    expect(conversationsPhrase(3)).toBe('3 conversations are hidden');
  });
});
