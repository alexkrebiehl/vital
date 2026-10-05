// GET /api/sources/removed — sources that were removed, when, and how many conversations they hide
// See `@/lib/sources/removed`.
import { removedSourcesResponse } from '@/lib/sources/removed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return removedSourcesResponse();
}
