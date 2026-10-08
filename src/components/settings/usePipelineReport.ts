'use client';

// The pipeline status report, read from /api/pipeline/status. Shared by the
// Sources tab (the Data pipeline card) and the Connections tab (Workout sources).

import { useCallback, useEffect, useState } from 'react';
import type { PipelineStatusReport } from '@/lib/pipeline/types';

export function usePipelineReport() {
  const [report, setReport] = useState<PipelineStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `quiet` refreshes in place (after the data-quality checks finish) instead
  // of blanking the panel back to its loading state.
  const load = useCallback(async (quiet = false) => {
    setError(null);
    if (!quiet) setReport(null);
    try {
      const res = await fetch('/api/pipeline/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The status endpoint answered HTTP ${res.status}.`);
      setReport((await res.json()) as PipelineStatusReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The pipeline status could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshQuietly = useCallback(() => void load(true), [load]);
  return { report, error, load, refreshQuietly };
}
