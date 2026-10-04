// ── The profiles the switcher offers (SERVER ONLY) ──────

import { readProfile } from '@/lib/profile/store';
import { allIdentities, identityProvider } from './index';
import { profilesDeclared } from './profiles';
import { runAsUser } from './scope';
import type { Identity, ProfileOption, ProfileSwitcherState } from './types';

export type { ProfileSwitcherState };

/**
 * What the profile switcher shows for `identity`. With a single profile it does
 * no extra reads: there is nothing to switch to.
 */
export async function profileSwitcherState(identity: Identity): Promise<ProfileSwitcherState> {
  const self: ProfileOption = { slug: identity.slug, name: null, primary: identity.primary };
  if (!profilesDeclared()) return { current: identity.slug, options: [self], canSwitch: false };

  const options = await Promise.all(
    (await allIdentities()).map(other =>
      runAsUser(other, async (): Promise<ProfileOption> => ({
        slug: other.slug,
        primary: other.primary,
        // readProfile never throws; an unreachable row reads as the defaults.
        name: other.userId ? (await readProfile()).name : null,
      }))
    )
  );
  return {
    current: identity.slug,
    options,
    canSwitch: identityProvider().canSwitch && options.length > 1,
  };
}
