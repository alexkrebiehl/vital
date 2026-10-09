// ── Shared by the get_app_data reads (SERVER ONLY) ──────────────────────────
//
// The answers every one of them gives in the same words, and the small helpers
// that keep a result free of nulls: a value that is missing is left out, never sent
// as null, NaN or zero.

import type { Schema } from '../../tools/args';
import type { Envelope } from '../envelope';
import { readersOf } from './app-readers';
import type { CapabilityContext, CapabilityManifestEntry, Coverage } from '../types';

export type Entry = Pick<CapabilityManifestEntry, 'id' | 'title' | 'category'>;

export const NO_DATABASE = 'No database is configured.';

/** A valid, empty answer for a capability with no window: the stated sentence, verbatim. */
export function nothing(entry: Pick<CapabilityManifestEntry, 'id'>, next: string, coverage?: Coverage): Envelope<never> {
  return { status: 'no_data_in_window', capability: entry.id, ...(coverage ? { coverage } : {}), next };
}

/** No arguments. */
export const NO_PARAMS: Schema = { type: 'object', properties: {}, additionalProperties: false };

/** Coverage for a capability read when asked: unavailable without a database, else unknown. */
export function storedCoverage(reason: string) {
  return async (ctx: CapabilityContext): Promise<Coverage> =>
    readersOf(ctx).databaseConfigured(ctx.env) ? { kind: 'unknown', reason } : { kind: 'unavailable', reason: NO_DATABASE };
}

/** Coverage for a capability computed from the installed dataset: nothing to ask the store. */
export const computedCoverage = (reason: string) => async (): Promise<Coverage> => ({ kind: 'unknown', reason });

/** Drops undefined and null members, so a missing value is absent rather than null. */
export function clean<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
