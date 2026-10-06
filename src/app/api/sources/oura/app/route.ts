// GET    /api/sources/oura/app — the Oura app credentials' status, never the secret
// PUT    /api/sources/oura/app — { clientId, clientSecret?, redirectUri }: store encrypted
// DELETE /api/sources/oura/app — remove the credentials and the Oura login with them
// See `@/lib/adapters/oura/app-connect`.
import { appRemove, appSave, appStatus } from '@/lib/adapters/oura/app-connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return appStatus();
}

export function PUT(request: Request) {
  return appSave(request);
}

export function DELETE() {
  return appRemove();
}
