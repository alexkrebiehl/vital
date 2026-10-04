// ── /api/session/profile ────────────────────────────────
//
// POST { slug } → the profile switcher's choice, stored in the `vital_profile`
// cookie. The next request is served as that profile (see @/lib/identity).
//
// This is a household switcher, not a sign-in: it accepts any DECLARED profile
// and nothing else, and it is refused (403) when the identity provider decides
// who the reader is rather than the reader.

import { NextResponse } from 'next/server';
import { identityProvider, PROFILE_COOKIE } from '@/lib/identity';
import { findProfile } from '@/lib/identity/profiles';

export const dynamic = 'force-dynamic';

/** A year: the choice is a preference of this browser, not a session. */
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export async function POST(request: Request) {
  if (!identityProvider().canSwitch) {
    return NextResponse.json({ error: 'Profiles are chosen by the identity provider here.' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The body must be JSON: { "slug": "…" }.' }, { status: 400 });
  }
  const slug = typeof body === 'object' && body !== null ? (body as { slug?: unknown }).slug : undefined;
  const profile = typeof slug === 'string' ? findProfile(slug.trim().toLowerCase()) : null;
  if (!profile) {
    return NextResponse.json({ error: 'There is no such profile.' }, { status: 404 });
  }
  const response = NextResponse.json({ slug: profile.slug });
  response.cookies.set(PROFILE_COOKIE, profile.slug, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
