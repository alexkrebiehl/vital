import type { CardRecord } from '@/lib/dashboard/types';
import { getCardUi } from './card-types';

/** A card's accessible name, for example "Steps, today". "card" when it cannot be read. */
export function describeCard(card: CardRecord): string {
  const ui = getCardUi(card.type);
  return ui && card.spec !== null ? ui.describe(card.spec) : 'card';
}
