// ── /api/pipeline/quality ───────────────────────────────
//
// The data-quality checks on the live export. They run in the background
// after the live data loads (see `startQualityJob`), so /api/pipeline/status
// never waits for them; this route does, for up to WAIT_MS, and the Settings
// panel shows a "checking" state until it answers. Server-only: it reads the
// same cached dataset as every other route and never returns a token.

import { NextResponse } from 'next/server';
import { installDataset, readDataMode, LiveDataUnavailableError } from '@/lib/adapters/runtime';
import type { PipelineQualityResponse } from '@/lib/pipeline/types';
import type { SilencedFinding } from '@/lib/adapters/quality-silenced';
import { silencedView } from '@/lib/pipeline/quality-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** How long one request waits for the checks before answering "still computing". */
const WAIT_MS = 45_000;

function respond(body: Omit<PipelineQualityResponse, 'silenced'> & { silenced?: SilencedFinding[] }) {
  return NextResponse.json({ silenced: [], ...body }, { status: 200, headers: { 'Cache-Control': 'no-store, private' } });
}

export async function GET() {
  if (readDataMode() === 'demo') {
    return respond({ state: 'unavailable', quality: null, detail: 'Demo mode: the fixtures are not an export, so there is nothing to check.' });
  }
  try {
    const job = (await installDataset()).quality;
    if (!job) return respond({ state: 'unavailable', quality: null, detail: 'No live export was read.' });
    await Promise.race([job.promise, new Promise(resolve => setTimeout(resolve, WAIT_MS))]);
    // The same silencing as the pipeline status report, so the two agree.
    const view = job.state === 'ready' && job.value ? await silencedView(job.value) : null;
    return respond({
      state: job.state,
      quality: view ? view.report : job.value,
      silenced: view ? view.silenced : [],
      detail: job.state === 'failed' ? job.error : job.state === 'computing' ? 'The checks are still running.' : null,
    });
  } catch (error) {
    const detail =
      error instanceof LiveDataUnavailableError
        ? `${error.message} ${error.detail}`
        : error instanceof Error
          ? error.message
          : 'The live data could not be read.';
    return respond({ state: 'unavailable', quality: null, detail });
  }
}
