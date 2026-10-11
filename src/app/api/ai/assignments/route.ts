// GET /api/ai/assignments — the provider, model and tuning chosen for each use
// PUT /api/ai/assignments — { use, providerId | null, model, options, revision }
// See `@/lib/ai/connect`.
import { listAssignmentStatus, saveAssignment } from '@/lib/ai/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return listAssignmentStatus();
}

export function PUT(request: Request) {
  return saveAssignment(request);
}
