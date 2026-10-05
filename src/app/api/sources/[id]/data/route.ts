// DELETE /api/sources/{id}/data?confirm=yes — purge a removed source's derived data now
// Refused while the source is active. See `@/lib/sources/removed`.
import { purgeSourceResponse } from '@/lib/sources/removed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return purgeSourceResponse(request, id);
}
