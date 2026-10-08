// ── Screen-reader sentences for dashboard changes (pure) ─────────────────────
//
// docs/design/dashboard.md §8.7. `describe` is the card type's accessible name,
// for example "Steps, today". Reorder sentences arrive with the move commands.

export const addedMessage = (describe: string, position: number, total: number): string =>
  `Added ${describe} at position ${position} of ${total}.`;

export const removedMessage = (describe: string): string => `Removed ${describe}.`;
