// PUT    /api/ai/providers/[id] — { name, kind, baseUrl, apiKey?, removeKey? }: probe, then store
// DELETE /api/ai/providers/[id] — remove it, and every model choice that used it
// See `@/lib/ai/connect`.
import { editProvider, removeProvider } from '@/lib/ai/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return editProvider(id, request);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return removeProvider(id);
}
