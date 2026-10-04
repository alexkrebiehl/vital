// ── Vitest setup ────────────────────────────────────────
//
// Server code reads the person it serves from the request scope
// (src/lib/identity/scope.ts), and a store refuses to run outside one. Tests
// call stores and route handlers directly, so they run as one fixed test
// profile unless a test enters a scope of its own with `runAsUser`.

import { setFallbackIdentityForTests } from '@/lib/identity/scope';

export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

setFallbackIdentityForTests({
  slug: 'owner',
  primary: true,
  userId: TEST_USER_ID,
  userError: null,
  env: process.env,
});
