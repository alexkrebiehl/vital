'use client';

// The pipeline status report, read part by part from /api/pipeline/status?part=…
// Shared by the Connections tab (every stage), the Sources tab (workout sources
// only) and the data freshness dialog.
//
// The report exists from the first render: every requested part starts as
// "Checking…" and is filled in as its own request answers, so a cold dataset
// load holds up only the stages that depend on it. A part whose request fails
// turns its stages to Unknown with the reason; the others are unaffected.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assembleReport, isPartFailure } from '@/lib/pipeline/assemble';
import { PIPELINE_PARTS, type PipelinePart, type PipelineParts } from '@/lib/pipeline/types';

export function usePipelineReport({ parts = PIPELINE_PARTS, enabled = true }: { parts?: PipelinePart[]; enabled?: boolean } = {}) {
  const [received, setReceived] = useState<PipelineParts>({});
  /** Counts full reloads ("Check again"), never a part arriving: a key for anything to restart then. */
  const [loads, setLoads] = useState(0);
  // One counter per part: an answer to a superseded request is dropped.
  const generation = useRef<Partial<Record<PipelinePart, number>>>({});
  const key = parts.join(',');
  const requested = useMemo(() => key.split(',') as PipelinePart[], [key]);

  const fetchPart = useCallback(async (part: PipelinePart) => {
    const gen = (generation.current[part] = (generation.current[part] ?? 0) + 1);
    let value: PipelineParts[PipelinePart];
    try {
      const res = await fetch(`/api/pipeline/status?part=${part}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`the status endpoint answered HTTP ${res.status}.`);
      value = await res.json();
    } catch (e) {
      value = { error: e instanceof Error ? e.message : 'the request failed.' };
    }
    if (generation.current[part] !== gen) return;
    setReceived(r => ({ ...r, [part]: value }));
  }, []);

  /** Check every requested part again; the stages go back to "Checking…". */
  const load = useCallback(() => {
    setReceived({});
    setLoads(n => n + 1);
    for (const part of requested) void fetchPart(part);
  }, [requested, fetchPart]);

  /** Fetch these parts (default: all requested) again in place, without blanking them. */
  const refreshQuietly = useCallback(
    (only?: PipelinePart[]) => {
      for (const part of only ?? requested) if (requested.includes(part)) void fetchPart(part);
    },
    [requested, fetchPart]
  );

  // Checked once, when first enabled (the freshness dialog enables it on opening).
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    load();
  }, [enabled, load]);

  const report = useMemo(() => assembleReport(received, { requested }), [received, requested]);
  // Only when nothing at all could be read is the report itself an error.
  const failed = requested.map(p => received[p]).filter(isPartFailure);
  const error = failed.length === requested.length ? `The status could not be read: ${failed[0].error}` : null;
  return { report, error, load, refreshQuietly, loads };
}
