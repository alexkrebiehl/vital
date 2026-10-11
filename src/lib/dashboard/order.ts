// ── Reordering cards (pure) ─────────────────────────────────────────────────
//
// docs/design/dashboard.md §8.7. Drag and the menu commands both end in
// `moveCard`, so the two paths cannot disagree about where a card lands.

export type MoveCommand = 'earlier' | 'later' | 'start' | 'end';

/** A new array with the card at `from` moved to `to`. A no-op or a bad index gives an unchanged copy. */
export function moveCard<T>(ids: readonly T[], from: number, to: number): T[] {
  const copy = [...ids];
  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!ok(from) || !ok(to) || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** The index a menu command moves card `id` to, or null when the command would change nothing. */
export function moveTarget(ids: readonly string[], id: string, command: MoveCommand): number | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  const last = ids.length - 1;
  const to = { earlier: at - 1, later: at + 1, start: 0, end: last }[command];
  return to === at || to < 0 || to > last ? null : to;
}
