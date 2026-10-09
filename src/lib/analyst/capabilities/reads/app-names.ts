// ── Source names, kept out of text the model reads (SERVER ONLY) ─────────────
//
// Only app.pipeline may name a data source (design §9.1). The words of other
// capabilities' upstream text (a quality finding's fix, say) are written by the app
// and may name one; this replaces any registered source's name with a neutral
// phrase. The names come from the registry, so a source added later is covered.

import { DATA_SOURCES } from '../../../sources/registry';

const NEUTRAL = 'the data source';

function names(): string[] {
  const own = DATA_SOURCES.filter(def => def.kind !== 'documents').flatMap(def => [def.displayName, def.displayName.split(' ')[0], def.id]);
  return [...new Set(own)].sort((a, b) => b.length - a.length);
}

/** `text` with the name of every data source replaced by a neutral phrase. */
export function neutralSourceNames(text: string): string {
  const pattern = new RegExp(`\\b(?:${names().map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return text.replace(pattern, NEUTRAL);
}
