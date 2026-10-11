// ── Guards for the Dashboard's standing rules ───────────────────────────────
//
// docs/design/dashboard.md §10. Each test reads the real tree or the real markup.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { DatasetMetaContext } from '@/components/data/DatasetProvider';
import { FALLBACK_CLIENT_META } from '@/components/data/fallback-meta';
import { REF, install, obs } from '@/lib/dashboard/synthetic-dataset.fake';
import type { CardRecord } from '@/lib/dashboard/types';
import { DATA_SOURCES } from '@/lib/sources/registry';
import { CardDialog } from './CardDialog';
import { DashboardView } from './DashboardView';
import type { DashboardState } from './dashboard-state';
import { moveActions } from './move-actions';

const ROOT = path.resolve(__dirname, '../../..');

function walk(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full, keep);
    return keep(full) ? [full] : [];
  });
}
const rel = (file: string) => path.relative(ROOT, file);

describe('guard: the drag library stays behind one file', () => {
  const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]@dnd-kit\//;
  const sources = walk(path.join(ROOT, 'src'), f => /\.(ts|tsx|js|jsx|mjs)$/.test(f));

  it('no file under src/ other than DashboardGrid.tsx imports @dnd-kit', () => {
    const offenders = sources.filter(f => IMPORT.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual(['src/components/dashboard/DashboardGrid.tsx']);
  });
});

describe('guard: no data-source name in dashboard markup', () => {
  afterEach(() => resetToDemoDataset());

  const card = (id: string, spec: unknown, over: Partial<CardRecord> = {}): CardRecord => ({
    id, type: 'value', spec, schemaVersion: 1, layout: { w: 1, h: 1, order: 0 }, revision: 1,
    createdAt: '2026-03-10T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z', status: 'ok', ...over,
  });
  const names = DATA_SOURCES.map(s => s.displayName);
  const withSources = (el: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(
      createElement(DatasetMetaContext.Provider, { value: { ...FALLBACK_CLIENT_META, activeSources: ['hae', 'oura', 'hevy'] } }, el)
    );

  it('cards in every state, the arrangeable grid, the dialog and the picker', () => {
    install({ step_count: [obs('2026-03-09', 5000), obs('2026-03-08', 4000)] });
    expect(names.length).toBeGreaterThanOrEqual(4);
    const cards = [
      card('a', { metricId: 'step_count', date: { kind: 'yesterday' } }),
      card('b', { metricId: 'step_count', date: { kind: 'range', start: '2026-03-01', end: '2026-03-09' } }),
      card('c', { metricId: 'resting_heart_rate', date: { kind: 'yesterday' } }),
      card('d', { metricId: 'not_a_metric', date: { kind: 'today' } }),
      card('e', null, { status: 'unreadable', problem: 'This card could not be read.' }),
      card('f', {}, { type: 'future-type' }),
    ];
    const state: DashboardState = { status: 'ready', cards, error: null, notice: 'The cards were not moved.' };
    const view = createElement(DashboardView, {
      state,
      context: { referenceKey: REF, system: 'metric' },
      onRetry: () => {},
      onReorder: () => {},
      actionsFor: c => moveActions(cards.map(x => x.id), c.id, () => {}),
    });
    const pages = [
      withSources(view),
      ...(['add', 'edit'] as const).map(mode =>
        withSources(
          createElement(CardDialog, {
            open: true, mode, card: mode === 'edit' ? cards[0] : undefined, onClose: () => {},
            onAdd: async () => ({ ok: true as const, card: cards[0] }),
            onEdit: async () => ({ ok: true as const, card: cards[0] }),
          })
        )
      ),
    ];
    for (const html of pages) for (const name of names) expect(html, name).not.toContain(name);
    expect(pages[0]).toContain('aria-label="Move Steps, yesterday"');
  });
});

describe('guard: the public docs stay free of hostnames, paths and keys', () => {
  const PUBLIC = /serverpile|\/home\/ace|homeserver|192\.168\.|sk-/;

  it('README, docs/, .env.example and docker-compose.yml contain none of them', () => {
    const files = [
      ...['README.md', '.env.example', 'docker-compose.yml'].map(f => path.join(ROOT, f)),
      ...walk(path.join(ROOT, 'docs'), f => f.endsWith('.md')),
    ];
    expect(files.length).toBeGreaterThan(5);
    const hits = files.flatMap(f =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) => (PUBLIC.test(line) ? [`${rel(f)}:${i + 1}`] : []))
    );
    expect(hits).toEqual([]);
  });
});
