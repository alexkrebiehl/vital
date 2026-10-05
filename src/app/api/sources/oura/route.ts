// GET    /api/sources/oura — connection status, no secrets
// DELETE /api/sources/oura — disconnect: revoke (best effort), delete the credential, clear the caches
// See `@/lib/adapters/oura/connect`.
import { disconnect, status } from '@/lib/adapters/oura/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return status();
}

export function DELETE() {
  return disconnect();
}
