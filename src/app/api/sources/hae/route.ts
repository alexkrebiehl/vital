// GET    /api/sources/hae — connection status, never the key
// PUT    /api/sources/hae — { endpoint, apiKey? }: probe, then store encrypted
// DELETE /api/sources/hae — remove the stored connection
// See `@/lib/adapters/hae-connect`.
import { remove, save, status } from '@/lib/adapters/hae-connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return status();
}

export function PUT(request: Request) {
  return save(request);
}

export function DELETE() {
  return remove();
}
