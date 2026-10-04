// GET /api/sources/oura/callback — see `@/lib/adapters/oura/connect`.
import { callback } from '@/lib/adapters/oura/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request) {
  return callback(request);
}
