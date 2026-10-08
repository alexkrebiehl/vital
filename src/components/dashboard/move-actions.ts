// ── The Move commands of a card's options menu (pure) ───────────────────────
//
// docs/design/dashboard.md §8.7. A command that would change nothing is left
// out, so the first card has no "Move earlier" and the last no "Move later".

import { moveTarget, type MoveCommand } from '@/lib/dashboard/order';
import type { CardAction } from './CardShell';

const COMMANDS: { command: MoveCommand; label: string }[] = [
  { command: 'earlier', label: 'Move earlier' },
  { command: 'later', label: 'Move later' },
  { command: 'start', label: 'Move to start' },
  { command: 'end', label: 'Move to end' },
];

/** `onMove` receives the index the card should land on. */
export function moveActions(ids: readonly string[], id: string, onMove: (to: number) => void): CardAction[] {
  return COMMANDS.flatMap(({ command, label }) => {
    const to = moveTarget(ids, id, command);
    return to === null ? [] : [{ id: `move-${command}`, label, onSelect: () => onMove(to) }];
  });
}
