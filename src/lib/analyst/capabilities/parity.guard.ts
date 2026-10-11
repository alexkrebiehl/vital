// ── The parity guard's pure checks (design §10) ─────────
//
// Kept apart from the test that enumerates the app so the guard itself can be tested
// with injected lists (the `guard itself` tests in parity.test.ts).

import type { Exemption } from './exemptions';

export type Kind = Exemption['kind'];
export const WHERE: Record<Kind, string> = {
  route: 'mirrors.routes',
  accessor: 'mirrors.accessors',
  page: 'mirrors.pages',
  metric: 'mirrors.metrics',
  source: 'a manifest `sources` tag',
};

/** Keys that are neither mirrored nor exempt, each with the exact fix. */
export function unmapped(kind: Kind, actual: readonly string[], mirrored: ReadonlySet<string>, exemptions: readonly Exemption[]): string[] {
  const exempt = new Set(exemptions.filter(e => e.kind === kind).map(e => e.key));
  return actual
    .filter(k => !mirrored.has(k) && !exempt.has(k))
    .map(
      k =>
        `${kind} ${k} has no capability and no exemption. Add it to ${WHERE[kind]} of the capability that serves it (src/lib/analyst/capabilities/areas/), ` +
        `or add { kind: '${kind}', key: '${k}', reason: '<why the analyst does not need it>' } to src/lib/analyst/capabilities/exemptions.permanent.ts. ` +
        `A tracked exemption (a known gap to close later) is no longer allowed.`
    );
}

/** Exemptions that are no longer needed: the key is mirrored now, or the thing is gone. */
export function stale(kind: Kind, actual: readonly string[], mirrored: ReadonlySet<string>, exemptions: readonly Exemption[]): string[] {
  const exist = new Set(actual);
  return exemptions
    .filter(e => e.kind === kind)
    .flatMap(e =>
      mirrored.has(e.key)
        ? [`STALE exemption: ${kind} ${e.key} is now covered by a capability. Delete its entry from the exemptions files.`]
        : !exist.has(e.key)
          ? [`STALE exemption: ${kind} ${e.key} no longer exists in the app. Delete its entry from the exemptions files.`]
          : []
    );
}
