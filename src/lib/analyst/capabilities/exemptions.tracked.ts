// ── Tracked exemptions: known gaps, each closed by a named gate ─
//
// design §1.3 is the inventory; §14 names the gates. A gate that closes a gap
// deletes its entries here and adds the key to a capability's `mirrors`. AN-D4 closed
// the last of them (get_app_data), so the list is empty; a new gap is added here with
// `t(...)`, naming the gate that closes it.

import type { Exemption } from './exemptions';

export const TRACKED_EXEMPTIONS: readonly Exemption[] = [];
