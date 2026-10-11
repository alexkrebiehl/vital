// ── Screen-reader sentences for dashboard changes (pure) ─────────────────────
//
// docs/design/dashboard.md §8.7. `describe` is the card type's accessible name,
// for example "Steps, today". Reorder sentences arrive with the move commands.

export const addedMessage = (describe: string, position: number, total: number): string =>
  `Added ${describe} at position ${position} of ${total}.`;

export const removedMessage = (describe: string): string => `Removed ${describe}.`;

export const pickedUpMessage = (describe: string, position: number, total: number): string =>
  `Picked up ${describe}. Position ${position} of ${total}.`;

export const movedMessage = (describe: string, position: number, total: number): string =>
  `${describe} moved to position ${position} of ${total}.`;

export const droppedMessage = (describe: string, position: number, total: number): string =>
  `${describe} dropped at position ${position} of ${total}.`;

export const cancelledMessage = (describe: string, position: number, total: number): string =>
  `Move cancelled. ${describe} is back at position ${position} of ${total}.`;
