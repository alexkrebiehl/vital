import { valueCardUi } from './value';
import type { CardTypeUi } from './types';

// The page, the grid and the view look a card's renderer up here and never name
// a type. A new type is one line.
const UI: Record<string, CardTypeUi<unknown, unknown>> = {
  [valueCardUi.type]: valueCardUi as unknown as CardTypeUi<unknown, unknown>,
};

export function getCardUi(type: string): CardTypeUi<unknown, unknown> | undefined {
  return Object.prototype.hasOwnProperty.call(UI, type) ? UI[type] : undefined;
}
