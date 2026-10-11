import { valueCardUi } from './value';
import type { CardTypeUi } from './types';

type AnyUi = CardTypeUi<unknown, unknown>;

// The page, the grid, the view and the dialog look a card's UI up here and never
// name a type. A new type is one line.
const UI = new Map<string, AnyUi>([[valueCardUi.type, valueCardUi as unknown as AnyUi]]);

export function getCardUi(type: string): AnyUi | undefined {
  return UI.get(type);
}

/** Add a card type's UI. Returns a function that removes it again (used by tests). */
export function registerCardUi<S, D>(ui: CardTypeUi<S, D>): () => void {
  if (UI.has(ui.type)) throw new Error(`Card type "${ui.type}" already has a UI.`);
  const stored = ui as unknown as AnyUi;
  UI.set(ui.type, stored);
  return () => {
    if (UI.get(ui.type) === stored) UI.delete(ui.type);
  };
}
