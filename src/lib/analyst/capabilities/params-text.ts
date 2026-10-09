// ── Parameter text for a capability (SERVER ONLY) ───────────
//
// What `list_capabilities` shows for one capability and what the generated docs table
// lists: the schema of the tool call that reads it, as plain lines. No values.

import type { Schema } from '../tools/args';
import { availableTools } from '../tools';
import { NO_PARAMS } from './reads/app-common';
import type { Capability } from './types';

type Cap = Pick<Capability<never, never>, 'tool' | 'params'>;

/** The arguments a capability's reader takes: its own for get_app_data, else its tool's. */
export function schemaOfCapability(cap: Cap): Schema {
  if (cap.tool === 'get_app_data') return cap.params ?? NO_PARAMS;
  const tool = availableTools({ data: {} as never }).find(t => t.name === cap.tool);
  return tool?.parameters ?? NO_PARAMS;
}

function typeOf(schema: Schema): string {
  if (schema.enum) return `one of ${schema.enum.join(', ')}`;
  return schema.type ?? 'any';
}

/** The parameter names, required ones starred. */
export function parameterNames(schema: Schema): string[] {
  return Object.keys(schema.properties ?? {}).map(name => (schema.required?.includes(name) ? `${name}*` : name));
}

/** One line per parameter: `name (type, required) description`. */
export function parametersText(schema: Schema): string {
  const entries = Object.entries(schema.properties ?? {});
  if (entries.length === 0) return 'No parameters.';
  return entries
    .map(([name, sub]) => {
      const required = schema.required?.includes(name) ? ', required' : '';
      const type = `${typeOf(sub)}${required}`;
      return `${name} (${type})${sub.description ? ` ${sub.description}` : ''}`;
    })
    .join('\n');
}
