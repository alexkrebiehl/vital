// GET /api/sources/oura/authorize — see `@/lib/adapters/oura/connect`.
import { authorize } from '@/lib/adapters/oura/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request) {
  return authorize(request);
}
