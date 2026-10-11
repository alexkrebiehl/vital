// GET  /api/ai/providers — the current user's AI providers, never a key
// POST /api/ai/providers — { name, kind, baseUrl, apiKey? }: probe, then store (key encrypted)
// See `@/lib/ai/connect`.
import { createProvider, listProviderStatus } from '@/lib/ai/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return listProviderStatus();
}

export function POST(request: Request) {
  return createProvider(request);
}
