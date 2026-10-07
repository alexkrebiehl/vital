'use client';

// ── Settings → Sources → Data pipeline: data quality ─
//
// What the checks in `src/lib/adapters/quality.ts` found in the live export,
// each finding with the days it affects and the steps that fix it, then the
// list of checks that ran and passed. Severity is always written out, never
// carried by colour alone.

import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { formatRange, type DataQualityReport, type QualityFinding, type QualitySeverity } from '@/lib/adapters/quality';
import type { PipelineQualityResponse, PipelineStatusReport } from '@/lib/pipeline/types';
import { Badge, Skeleton } from '@/components/ui/primitives';

const SEVERITY: Record<QualitySeverity, { label: string; variant: 'warning' | 'info' | 'default'; icon: typeof CircleAlert; tone: string }> = {
  problem: { label: 'Problem', variant: 'warning', icon: CircleAlert, tone: 'text-category-attention' },
  warning: { label: 'Worth fixing', variant: 'warning', icon: TriangleAlert, tone: 'text-category-attention' },
  info: { label: 'Note', variant: 'info', icon: Info, tone: 'text-text-secondary' },
};

/**
 * The data-quality part of the pipeline panel. The checks run in the
 * background after the live data loads, so the pipeline report usually
 * arrives first: then this section says it is checking, waits on
 * /api/pipeline/quality on its own, and fills in when the result is ready —
 * the rest of the page never waits for it. `onReady` lets the panel refresh
 * the stage list once the result is in.
 */
export function DataQualitySection({ report, onReady }: { report: PipelineStatusReport; onReady?: () => void }) {
  if (report.qualityState === 'unavailable') return null;
  if (report.qualityState === 'ready' && report.quality) return <DataQuality quality={report.quality} />;
  return <PendingDataQuality key={report.checkedAt} initialFailure={report.qualityState === 'failed'} onReady={onReady} />;
}

function PendingDataQuality({ initialFailure, onReady }: { initialFailure: boolean; onReady?: () => void }) {
  const [result, setResult] = useState<PipelineQualityResponse | null>(
    initialFailure ? { state: 'failed', quality: null, detail: 'The checks could not finish.' } : null
  );

  useEffect(() => {
    if (initialFailure) return;
    let cancelled = false;
    (async () => {
      // The route waits for the checks, up to a limit; ask again while they are still running.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const res = await fetch('/api/pipeline/quality', { cache: 'no-store' });
          if (!res.ok) throw new Error(`The quality endpoint answered HTTP ${res.status}.`);
          const body = (await res.json()) as PipelineQualityResponse;
          if (body.state === 'computing') continue;
          if (cancelled) return;
          setResult(body);
          if (body.state === 'ready') onReady?.();
          return;
        } catch (e) {
          if (!cancelled) setResult({ state: 'failed', quality: null, detail: e instanceof Error ? e.message : 'The checks could not be read.' });
          return;
        }
      }
      if (!cancelled) setResult({ state: 'computing', quality: null, detail: 'The checks are taking longer than usual. Use “Check again” in a minute.' });
    })();
    return () => {
      cancelled = true;
    };
  }, [initialFailure, onReady]);

  if (result?.state === 'ready' && result.quality) return <DataQuality quality={result.quality} />;
  if (result?.state === 'unavailable') return null;

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="data-quality-heading" aria-busy={!result}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 id="data-quality-heading" className="text-sm font-semibold text-text-primary">
          Data quality
        </h3>
        {!result ? (
          <Badge variant="default" className="text-[10px]">
            <LoaderCircle size={11} className="mr-1 motion-safe:animate-spin" aria-hidden="true" />
            Checking…
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[10px]">{result.state === 'failed' ? 'Could not check' : 'Still checking'}</Badge>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-[11px] text-text-secondary leading-relaxed mb-4">
        {!result
          ? 'Checking the export’s records for activity counted twice, duplicate readings, missing days and a stalled automation. This runs in the background after your data loads; nothing else on the page waits for it.'
          : result.detail}
      </p>
      {!result && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton height={14} width="55%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={14} width="50%" />
        </div>
      )}
    </section>
  );
}

export function DataQuality({ quality }: { quality: DataQualityReport }) {
  const serious = quality.findings.filter(f => f.severity !== 'info').length;
  const notes = quality.findings.length - serious;
  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="data-quality-heading">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 id="data-quality-heading" className="text-sm font-semibold text-text-primary">
          Data quality
        </h3>
        <Badge variant={serious ? 'warning' : 'success'} className="text-[10px]">
          {serious
            ? `${serious} to fix`
            : quality.findings.length
              ? 'No recent problems'
              : 'All checks passed'}
        </Badge>
        {notes > 0 && (
          <Badge variant="info" className="text-[10px]">
            {notes} note{notes === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed mb-4">
        Checked on the export’s records as the server stores them, before Vital adds them up per day. Anything affecting
        only days more than 90 days ago is a note: recent figures are not affected. The checks only report: nothing here
        changes your data.
      </p>

      {quality.findings.length > 0 && (
        <ul className="space-y-3 list-none p-0 m-0 mb-5">
          {quality.findings.map((f, i) => (
            <Finding key={`${f.check}-${i}`} finding={f} />
          ))}
        </ul>
      )}

      <ul className="space-y-1.5 list-none p-0 m-0" aria-label="Checks that ran">
        {quality.checks.map(c => (
          <li key={c.id} className="flex items-start gap-2 text-[12px]">
            {c.outcome === 'pass' ? (
              <CircleCheck size={14} className="mt-0.5 shrink-0 text-category-activity" aria-hidden="true" />
            ) : c.outcome === 'note' ? (
              <Info size={14} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
            ) : (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
            )}
            <span>
              <span className="font-medium text-text-primary">{c.label}</span>
              <span className="sr-only">{c.outcome === 'pass' ? ': passed' : c.outcome === 'note' ? ': note' : ': flagged'}</span>
              <span className="text-text-secondary"> — {c.summary}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Finding({ finding: f }: { finding: QualityFinding }) {
  const s = SEVERITY[f.severity];
  const Icon = s.icon;
  return (
    <li className="rounded-control border border-border bg-surface-muted/40 p-4">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{f.title}</span>
            <Badge variant={s.variant} className="text-[10px]">{s.label}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-text-secondary leading-relaxed">{f.detail}</p>
          {f.ranges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Affected days">
              {f.ranges.map(r => (
                <span key={`${r.from}-${r.to}`} className="rounded-full border border-border px-2 py-0.5 text-[10px] tnum text-text-secondary">
                  {formatRange(r)}
                  {r.days > 1 ? ` · ${r.days} days` : ''}
                </span>
              ))}
            </div>
          )}
          <details className="mt-3 group">
            <summary className="cursor-pointer text-[12px] font-medium text-primary">How to fix it</summary>
            <ol className="mt-2 ml-4 list-decimal space-y-1.5 text-[12px] text-text-secondary leading-relaxed">
              {f.remedy.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </details>
        </div>
      </div>
    </li>
  );
}
