// ── The static capability map (design §5.1) ─────────────────
//
// Pure. One line per capability, `id — title: what it holds · tool`, grouped by area.
// No values, dates or counts: those change with every request and live in the
// coverage index. Appended to the system prompt whenever tools are offered, so it
// replaces the tool list `DATA_TOOLS_PROMPT` used to carry. At most 4,000 characters.

import type { CapabilityManifestEntry } from './types';

export const CAPABILITY_MAP_MAX_CHARS = 4_000;

export type MapEntry = Pick<CapabilityManifestEntry, 'id' | 'area' | 'title' | 'tool'> & { holds?: string };

const HEADER =
  'WHAT THE APP HOLDS: every capability, by area, as id — title: what it holds · the tool that reads it. Any day or period can be asked for. list_capabilities gives a capability\'s parameters, example calls and how much the app holds.';

export function renderCapabilityMap(caps: readonly MapEntry[]): string {
  const lines: string[] = [HEADER];
  let area: string | null = null;
  for (const c of caps) {
    if (c.area !== area) {
      area = c.area;
      lines.push(`[${c.area}]`);
    }
    lines.push(`${c.id} — ${c.title}${c.holds ? `: ${c.holds}` : ''} · ${c.tool}`);
  }
  return lines.join('\n');
}
