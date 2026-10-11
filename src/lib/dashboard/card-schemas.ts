// ── Dashboard card type registry (server and client, no React) ───────────────
//
// docs/design/dashboard.md §3.4 and §4.1. The schema half of a card type:
// what its spec may hold, which sizes it offers, which version it is. The
// React half (renderer, editor) lives under src/components/dashboard.
//
// The API routes and the store go through this module only; none of them names
// a type.

import type { CardRecord, CardSize } from './types';
import { MAX_SPEC_BYTES } from './types';
import { valueSchema } from './value-schema';

export interface CardTypeSchema<S> {
  type: string; // 'value'
  version: number; // 1
  label: string; // 'Value' (type chooser)
  sizes: readonly CardSize[];
  defaultSize: CardSize; // must be in sizes
  validate(input: unknown): { ok: true; spec: S } | { ok: false; errors: string[] };
  migrate(spec: unknown, from: number): unknown; // identity at `version`
}

/** A schema of any spec type, as the registry stores and hands it out. */
type AnySchema = CardTypeSchema<unknown>;

const schemas = new Map<string, AnySchema>();

const sameSize = (a: CardSize, b: CardSize) => a.w === b.w && a.h === b.h;

/** Add a card type. Returns a function that removes it again (used by tests). */
export function registerCardSchema<S>(schema: CardTypeSchema<S>): () => void {
  if (schemas.has(schema.type)) throw new Error(`Card type "${schema.type}" is already registered.`);
  if (!schema.sizes.some(s => sameSize(s, schema.defaultSize))) {
    throw new Error(`The default size of card type "${schema.type}" must be one of its sizes.`);
  }
  const stored = schema as unknown as AnySchema;
  schemas.set(schema.type, stored);
  return () => {
    if (schemas.get(schema.type) === stored) schemas.delete(schema.type);
  };
}

export function getCardSchema(type: string): AnySchema | undefined {
  return schemas.get(type);
}

export function listCardSchemas(): AnySchema[] {
  return Array.from(schemas.values());
}

registerCardSchema(valueSchema);

// ── Write-side validation ────────────────────────────

export type CardInputResult =
  | { ok: true; type: string; spec: unknown; schemaVersion: number; size: CardSize }
  | { ok: false; errors: string[] };

function parseSize(input: unknown): CardSize | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('w') || !keys.includes('h')) return null;
  const { w, h } = input as { w: unknown; h: unknown };
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  return { w: w as number, h: h as number };
}

/**
 * Validate what a create (no `stored`) or an edit (`stored` = the card's type
 * and current size) may write. Every failure is a sentence for the reader.
 */
export function validateCardInput(
  input: { type?: unknown; spec?: unknown; size?: unknown },
  stored?: { type: string; size?: CardSize }
): CardInputResult {
  let type: string;
  if (stored) {
    if (input.type !== undefined && input.type !== stored.type) {
      return { ok: false, errors: ['The type of a card cannot be changed.'] };
    }
    type = stored.type;
  } else {
    if (typeof input.type !== 'string' || input.type === '') {
      return { ok: false, errors: ['A card needs a type.'] };
    }
    type = input.type;
  }
  const schema = getCardSchema(type);
  if (!schema) return { ok: false, errors: [`There is no card type "${type}".`] };

  const json = JSON.stringify(input.spec);
  if (json === undefined) return { ok: false, errors: ['A card needs settings.'] };
  if (new TextEncoder().encode(json).length > MAX_SPEC_BYTES) {
    return { ok: false, errors: [`The card settings are larger than ${MAX_SPEC_BYTES} bytes.`] };
  }

  const errors: string[] = [];
  const checked = schema.validate(input.spec);
  if (!checked.ok) errors.push(...checked.errors);

  let size: CardSize = stored?.size ?? schema.defaultSize;
  if (input.size !== undefined) {
    const parsed = parseSize(input.size);
    if (!parsed) errors.push('The size must be a whole number of columns (w) and rows (h).');
    else if (!schema.sizes.some(s => sameSize(s, parsed))) {
      errors.push(`A ${schema.label} card cannot be ${parsed.w}×${parsed.h}.`);
    } else size = parsed;
  }
  if (errors.length || !checked.ok) return { ok: false, errors };
  return { ok: true, type, spec: checked.spec, schemaVersion: schema.version, size };
}

// ── Read-side: a stored row becomes a card, never a dropped row ──────────────

/** The columns of dashboard_cards, as `pg` returns them. */
export interface StoredCardRow {
  id: unknown;
  card_type: unknown;
  spec: unknown;
  schema_version: unknown;
  position: unknown;
  width: unknown;
  height: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export const PROBLEM_UNKNOWN_TYPE = 'This card was made by a newer version of Vital, or its type was removed.';
export const PROBLEM_NEWER_VERSION = 'This card was saved by a newer version of Vital.';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export function readStoredCard(row: StoredCardRow): CardRecord {
  const type = String(row.card_type);
  const version = Number(row.schema_version);
  const base = {
    id: String(row.id),
    type,
    schemaVersion: version,
    layout: { order: Number(row.position), w: Number(row.width), h: Number(row.height) },
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  const unreadable = (problem: string): CardRecord => ({ ...base, spec: null, status: 'unreadable', problem });

  const schema = getCardSchema(type);
  if (!schema) return unreadable(PROBLEM_UNKNOWN_TYPE);
  if (version > schema.version) return unreadable(PROBLEM_NEWER_VERSION);
  try {
    const checked = schema.validate(schema.migrate(row.spec, version));
    if (!checked.ok) return unreadable(checked.errors.join(' '));
    return { ...base, spec: checked.spec, status: 'ok' };
  } catch {
    return unreadable('The settings of this card could not be read.');
  }
}
