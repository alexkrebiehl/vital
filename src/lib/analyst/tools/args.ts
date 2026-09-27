// ── Tool argument checking ──────────────────────────────
//
// A deliberately small subset of JSON Schema — object/array/string/number/
// integer/boolean, enum, required, min/max, items, properties — enough for the
// analyst's tools and no dependency. Problems are phrased so the model can fix
// its call and try again.

export type Schema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: readonly (string | number)[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  additionalProperties?: boolean;
};

export function checkArgs(schema: Schema, value: unknown, where = 'arguments'): string[] {
  const errors: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${where} must be an object.`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (obj[key] === undefined) errors.push(`${where}.${key} is required.`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) errors.push(`${where}.${key} is not an accepted argument.`);
        continue;
      }
      if (v !== undefined) errors.push(...checkArgs(sub, v, `${where}.${key}`));
    }
    return errors;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return [`${where} must be an array.`];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${where} may have at most ${schema.maxItems} items.`);
    if (schema.items) value.forEach((v, i) => errors.push(...checkArgs(schema.items!, v, `${where}[${i}]`)));
    return errors;
  }
  if (t === 'string') {
    if (typeof value !== 'string') return [`${where} must be a string.`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${where} may be at most ${schema.maxLength} characters.`);
  } else if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (t === 'integer' && !Number.isInteger(value))) return [`${where} must be ${t === 'integer' ? 'a whole number' : 'a number'}.`];
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${where} must be at most ${schema.maximum}.`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [`${where} must be true or false.`];
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) errors.push(`${where} must be one of: ${schema.enum.join(', ')}.`);
  return errors;
}
