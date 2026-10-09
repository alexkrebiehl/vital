// ── The data-quality answer (SERVER ONLY) ───────────────────────────────────
//
// What GET /api/pipeline/quality serves, as a function: wait for the background
// checks (up to `waitMs`), apply the reader's silenced findings, and say plainly when
// there is nothing to report and why. The route and the analyst's app.data_quality
// capability both call it, so they cannot disagree.

import { installDataset, readDataMode, LiveDataUnavailableError } from '@/lib/adapters/runtime';
import { silencedView } from '@/lib/pipeline/quality-view';
import type { PipelineQualityResponse } from '@/lib/pipeline/types';

/** How long one request waits for the checks before answering "still computing". */
export const QUALITY_WAIT_MS = 45_000;

export async function readQualityResponse(options: { env?: NodeJS.ProcessEnv; waitMs?: number } = {}): Promise<PipelineQualityResponse> {
  const env = options.env ?? process.env;
  const waitMs = options.waitMs ?? QUALITY_WAIT_MS;
  if (readDataMode(env) === 'demo') {
    return { state: 'unavailable', quality: null, silenced: [], detail: 'Demo mode: the fixtures are not an export, so there is nothing to check.' };
  }
  try {
    const job = (await installDataset({ env })).quality;
    if (!job) return { state: 'unavailable', quality: null, silenced: [], detail: 'No live export was read.' };
    await Promise.race([job.promise, new Promise(resolve => setTimeout(resolve, waitMs))]);
    // The same silencing as the pipeline status report, so the two agree.
    const view = job.state === 'ready' && job.value ? await silencedView(job.value, { env }) : null;
    return {
      state: job.state,
      quality: view ? view.report : job.value,
      silenced: view ? view.silenced : [],
      detail: job.state === 'failed' ? job.error : job.state === 'computing' ? 'The checks are still running.' : null,
    };
  } catch (error) {
    const detail =
      error instanceof LiveDataUnavailableError
        ? `${error.message} ${error.detail}`
        : error instanceof Error
          ? error.message
          : 'The live data could not be read.';
    return { state: 'unavailable', quality: null, silenced: [], detail };
  }
}
