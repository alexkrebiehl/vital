// GET    /api/sources/hevy — connection status, never the key
// PUT    /api/sources/hevy — { apiKey?, url? }: probe, then store encrypted
// DELETE /api/sources/hevy — remove the stored connection
// See `@/lib/workout-sources/hevy/hevy-connect`.
import { remove, save, status } from '@/lib/workout-sources/hevy/hevy-connect';

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
