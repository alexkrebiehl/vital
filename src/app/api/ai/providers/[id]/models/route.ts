// GET /api/ai/providers/[id]/models — { models, note }: what the provider offers, for the model picker
// See `@/lib/ai/connect`.
import { providerModels } from '@/lib/ai/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return providerModels(id);
}
