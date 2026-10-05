// ── Page context: what the reader is looking at (client-safe) ─
//
// A "Discuss with analyst" dialog names the page it was opened from with one of
// these small descriptors. The browser sends only the descriptor — never page
// text — and the server resolves it into the page's current state from the same
// routine service the page itself reads (see page-context.ts), so the model sees
// exactly what the page shows without the browser being able to inject content.

export type PageContextRef =
  | { kind: 'routine' }
  | { kind: 'routine-path'; pathId: string }
  | { kind: 'routine-workout'; templateId: string }
  | { kind: 'routine-untracked'; name: string }
  | { kind: 'body-goal' };

const MAX_ID_CHARS = 120;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned.length > 0 && cleaned.length <= MAX_ID_CHARS ? cleaned : null;
}

/** A descriptor from a request body, or null for anything that is not one exactly. */
export function parsePageContextRef(raw: unknown): PageContextRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'routine':
      return { kind: 'routine' };
    case 'routine-path': {
      const pathId = text(r.pathId);
      return pathId ? { kind: 'routine-path', pathId } : null;
    }
    case 'routine-workout': {
      const templateId = text(r.templateId);
      return templateId ? { kind: 'routine-workout', templateId } : null;
    }
    case 'body-goal':
      return { kind: 'body-goal' };
    case 'routine-untracked': {
      const name = text(r.name);
      return name ? { kind: 'routine-untracked', name } : null;
    }
    default:
      return null;
  }
}
