// ── Identity types ──────────────────────────────────────

/** Who a request is served as. */
export interface Identity {
  /** The declared profile slug (see ./profiles). */
  slug: string;
  /** True for the first declared profile. */
  primary: boolean;
  /** The `users.id` row this profile's data is stored under; null when the
   *  database could not be reached to resolve it. */
  userId: string | null;
  /** Why `userId` is null, when it is. */
  userError: string | null;
  /** The environment with this profile's per-person variables overlaid. */
  env: NodeJS.ProcessEnv;
}

/** One profile as the switcher lists it. */
export interface ProfileOption {
  slug: string;
  /** The profile's display name, or null when none is stored. */
  name: string | null;
  primary: boolean;
}

/** What the profile switcher shows. */
export interface ProfileSwitcherState {
  /** The profile this page is served as. */
  current: string;
  /** Every declared profile, primary first, with its stored display name. */
  options: ProfileOption[];
  /** False when there is nobody else to switch to, or the identity provider
   *  decides who the reader is. */
  canSwitch: boolean;
}
