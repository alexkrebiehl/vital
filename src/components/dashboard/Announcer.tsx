// ── One polite live region for dashboard changes ────────────────────────────
//
// docs/design/dashboard.md §8.7. Always rendered, so the region exists before
// its text changes; visually hidden. The sentences come from `announce.ts`.

export function Announcer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
