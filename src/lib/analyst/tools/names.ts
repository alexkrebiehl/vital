// The names of the read-only data tools, from the capability manifest. Kept apart from the
// tools themselves so the client can label a lookup without importing server code.

import { DATA_TOOL_LABELS } from '../capabilities/manifest';

export const DATA_TOOL_NAMES: readonly string[] = Object.keys(DATA_TOOL_LABELS);

export function isDataTool(name: string): boolean {
  return DATA_TOOL_NAMES.includes(name);
}
