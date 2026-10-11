import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { registerCardSchema } from '@/lib/dashboard/card-schemas';
import { FALLBACK_CLIENT_META } from '@/components/data/fallback-meta';
import { DatasetMetaContext } from '@/components/data/DatasetProvider';
import { DATA_SOURCES } from '@/lib/sources/registry';
import { REF, install, obs } from '@/lib/dashboard/synthetic-dataset.fake';
import type { CardRecord } from '@/lib/dashboard/types';
import { registerCardUi } from './card-types';
import { CardDialog } from './CardDialog';

const record = (spec: unknown): CardRecord => ({
  id: 'card-1', type: 'value', spec, schemaVersion: 1, layout: { w: 1, h: 1, order: 0 }, revision: 3,
  createdAt: '2026-03-10T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z', status: 'ok',
});
const STEPS = record({ metricId: 'step_count', date: { kind: 'yesterday' } });
const ok = async (card: CardRecord) => ({ ok: true as const, card });

function render(props: { mode: 'add' | 'edit'; card?: CardRecord; sources?: string[] }) {
  const dialog = createElement(CardDialog, {
    open: true, mode: props.mode, card: props.card, onClose: () => {}, onAdd: () => ok(STEPS), onEdit: () => ok(STEPS),
  });
  return renderToStaticMarkup(
    props.sources
      ? createElement(DatasetMetaContext.Provider, { value: { ...FALLBACK_CLIENT_META, activeSources: props.sources } }, dialog)
      : dialog
  );
}
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

afterEach(() => resetToDemoDataset());

describe('CardDialog', () => {
  it('add: titled Add card, submit disabled until the card is valid, Cancel present, no preview yet', () => {
    const html = render({ mode: 'add' });
    expect(html).toContain('aria-label="Add card"');
    expect(button(html, 'Add card')).toContain('disabled=""');
    expect(button(html, 'Cancel')).not.toBe('');
    expect(html).not.toContain('Save changes');
    expect(html).toContain('Choose a metric and a date to see a preview.');
  });

  it('edit: titled Edit card, Save changes enabled, the real card as the preview', () => {
    install({ step_count: [obs('2026-03-09', 4321)] });
    const html = render({ mode: 'edit', card: STEPS });
    expect(html).toContain('aria-label="Edit card"');
    expect(button(html, 'Save changes')).not.toBe('');
    expect(button(html, 'Save changes')).not.toContain('disabled=""');
    expect(html).not.toContain('>Add card<');
    expect(html).toContain('Preview');
    expect(html).toContain('4.3K');
    expect(html).toContain(`Yesterday · Mar 9, 2026`);
    expect(REF).toBe('2026-03-10');
  });

  it('edit: the editor is filled in with the card’s metric and date', () => {
    const html = render({ mode: 'edit', card: STEPS });
    expect(html).toMatch(/value="step_count"[^>]*checked=""|checked=""[^>]*value="step_count"/);
  });

  it('edit: Save changes is disabled while the card’s settings do not validate', () => {
    const html = render({ mode: 'edit', card: record({ metricId: 'nope', date: { kind: 'today' } }) });
    expect(button(html, 'Save changes')).toContain('disabled=""');
  });

  it('hides the type chooser with one type, shows it with two, and hides it again', () => {
    expect(render({ mode: 'add' })).not.toContain('Card type');
    const unregisterSchema = registerCardSchema({
      type: 'fake', version: 1, label: 'Fake chart', sizes: [{ w: 2, h: 2 }], defaultSize: { w: 2, h: 2 },
      validate: input => ({ ok: true, spec: input }), migrate: spec => spec,
    });
    const unregisterUi = registerCardUi({
      type: 'fake', resolve: () => null, Card: () => null, Editor: () => createElement('p', null, 'Fake editor'),
      describe: () => 'Fake', heading: () => ({ title: 'Fake' }),
    });
    try {
      const html = render({ mode: 'add' });
      expect(html).toContain('Card type');
      expect(html).toContain('Fake chart');
      expect(html).toContain('>Value<');
    } finally {
      unregisterUi();
      unregisterSchema();
    }
    expect(render({ mode: 'add' })).not.toContain('Card type');
  });

  it('edit: never offers to change the type', () => {
    const unregisterSchema = registerCardSchema({
      type: 'fake', version: 1, label: 'Fake chart', sizes: [{ w: 1, h: 1 }], defaultSize: { w: 1, h: 1 },
      validate: input => ({ ok: true, spec: input }), migrate: spec => spec,
    });
    try {
      expect(render({ mode: 'edit', card: STEPS })).not.toContain('Card type');
    } finally {
      unregisterSchema();
    }
  });

  it('shows no data-source name, with two sources connected', () => {
    const names = DATA_SOURCES.map(s => s.displayName);
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const mode of ['add', 'edit'] as const) {
      const html = render({ mode, card: mode === 'edit' ? STEPS : undefined, sources: ['hae', 'oura'] });
      for (const name of names) expect(html, name).not.toContain(name);
    }
  });
});
