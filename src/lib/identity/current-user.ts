// ── The current user (SERVER ONLY) ───────────────────────
//
// Vital is single-owner today: there is no users table and no sign-in. Rows that
// belong to a person (the AI providers and model choices, db/migrations/0017)
// are nevertheless written with a `user_id`, and every store takes it from here
// rather than writing the literal itself.
//
// When household profiles land, this is the one function that changes: it reads
// the user from the request scope instead of returning the owner.

/** The id every per-user row is written under while Vital has a single owner. */
export const OWNER_USER_ID = 'owner';

/** The user the current request acts for. */
export function currentUserId(): string {
  return OWNER_USER_ID;
}
