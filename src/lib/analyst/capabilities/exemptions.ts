// ── Exemptions from the parity test (design §10.2) ──────
//
// Everything the app serves must be reachable by the analyst or listed here with
// a reason. Two kinds:
//
//   permanent  a decision: the analyst does not need it, and says why
//   tracked    a known gap to close: the reason starts with the gate that closes it
//
// Each gate that closes a gap deletes its entries (the test fails on an exemption
// that is no longer needed). AN-D7 sets ALLOW_TRACKED to false: from then on only
// the permanent ones pass. Exemptions are code, so they are reviewed in the diff.

import { PERMANENT_EXEMPTIONS } from './exemptions.permanent';
import { TRACKED_EXEMPTIONS } from './exemptions.tracked';

export interface Exemption {
  kind: 'route' | 'accessor' | 'page' | 'metric' | 'source';
  /** 'GET /api/map-providers', 'sleepSeries', '/settings', 'blood_pressure', 'hae'. */
  key: string;
  /** At least 30 characters; says WHY the analyst does not need it, or which gate closes the gap. */
  reason: string;
  /** A known gap to close, not a decision. */
  tracked?: true;
}

/** AN-D7 closed the list: a tracked exemption (a known gap) fails the parity test. */
export const ALLOW_TRACKED = false;

export const EXEMPTIONS: readonly Exemption[] = [...PERMANENT_EXEMPTIONS, ...TRACKED_EXEMPTIONS];
