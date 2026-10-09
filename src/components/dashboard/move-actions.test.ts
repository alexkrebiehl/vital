import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardShell } from './CardShell';
import { moveActions } from './move-actions';

const ids = ['a', 'b', 'c'];
const labels = (id: string) => moveActions(ids, id, () => {}).map(a => a.label);

describe('moveActions', () => {
  it('first card: only later and end', () => expect(labels('a')).toEqual(['Move later', 'Move to end']));
  it('middle card: all four, in a fixed order', () =>
    expect(labels('b')).toEqual(['Move earlier', 'Move later', 'Move to start', 'Move to end']));
  it('last card: only earlier and start', () => expect(labels('c')).toEqual(['Move earlier', 'Move to start']));
  it('a lone card has no move commands', () => expect(moveActions(['a'], 'a', () => {})).toEqual([]));

  it('each command hands the target index to onMove', () => {
    const got: number[] = [];
    for (const a of moveActions(ids, 'b', to => got.push(to))) a.onSelect();
    expect(got).toEqual([0, 2, 0, 2]);
  });

  it('the open options menu lists them for the first, middle and last card', () => {
    const menu = (id: string) =>
      [
        ...renderToStaticMarkup(
          createElement(CardShell, {
            title: 'Steps',
            initialMenuOpen: true,
            actions: [
              { id: 'edit', label: 'Edit', onSelect: () => {} },
              ...moveActions(ids, id, () => {}),
              { id: 'remove', label: 'Remove', onSelect: () => {}, danger: true },
            ],
          })
        ).matchAll(/role="menuitem"[^>]*>([^<]+)</g),
      ].map(m => m[1]);
    expect(menu('a')).toEqual(['Edit', 'Move later', 'Move to end', 'Remove']);
    expect(menu('b')).toEqual(['Edit', 'Move earlier', 'Move later', 'Move to start', 'Move to end', 'Remove']);
    expect(menu('c')).toEqual(['Edit', 'Move earlier', 'Move to start', 'Remove']);
  });
});
