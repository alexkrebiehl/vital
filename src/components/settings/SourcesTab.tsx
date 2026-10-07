'use client';

// ── Settings → Sources ──────────────────────────────────────────────────────
//
// What feeds the app: the Health Auto Export card, the Oura card, then the Data
// pipeline card with its data-quality section. The first-run gate opens this tab,
// so a saved first connection takes the reader on to the app.

import { useRouter, useSearchParams } from 'next/navigation';
import { Database, Plug } from 'lucide-react';
import { useSetupFailure } from '@/components/data/setup-mode';
import { Badge, Button, Card, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { STAGE_STATUS_LABEL, type StageStatus } from '@/lib/pipeline/types';
import { DataQualitySection } from './DataQuality';
import { HaeConnection } from './HaeConnection';
import { nextStepAfterChange } from './hae-card';
import { OuraConnection } from './OuraConnection';
import { SectionHead } from './SectionHead';
import { usePipelineReport } from './usePipelineReport';

export function SourcesTab() {
  const router = useRouter();
  const ouraNotice = useSearchParams().get('oura');
  const settingUp = useSetupFailure() !== null;
  const { report, error, load, refreshQuietly } = usePipelineReport();

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <HaeConnection
          heading={title => <SectionHead icon={<Plug size={18} className="text-text-secondary" />} title={title} />}
          onChanged={event => {
            // First run: a saved connection takes the reader on to the app with a full page load,
            // so the server decides afresh whether the data can be read. (A client-side refresh
            // racing a client-side navigation leaves the old "no source" state on screen.) If the
            // data still cannot be read the gate sends them straight back here, with the real reason.
            if (nextStepAfterChange(event, settingUp) === 'open-app') window.location.assign('/');
            else router.refresh();
          }}
        />
      </Card>

      <Card className="p-6">
        <OuraConnection
          heading={title => <SectionHead icon={<Plug size={18} className="text-text-secondary" />} title={title} />}
          noticeParam={ouraNotice}
          onChanged={() => router.refresh()}
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SectionHead icon={<Database size={18} className="text-text-secondary" />} title="Data pipeline" />
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Check again
          </Button>
        </div>

        {error && (
          <ErrorState
            title="The pipeline status could not be read"
            message={`${error} No live status is being assumed in its place.`}
            onRetry={() => void load()}
          />
        )}

        {!report && !error && (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Checking each pipeline stage</span>
            <Skeleton height={16} width="40%" />
            <Skeleton height={80} />
          </div>
        )}

        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant={report.mode === 'live' ? 'success' : 'accent'}>
                {report.mode === 'live' ? 'Live source configured' : 'Demo mode'}
              </Badge>
              <span className="text-xs text-text-secondary">{report.summary}</span>
            </div>
            <ol className="space-y-3 list-none p-0 m-0">
              {report.stages.map((stage, i) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <StageDot status={stage.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{stage.name}</span>
                      <StageLabel status={stage.status} />
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">{stage.detail}</p>
                    <p className="text-[10px] text-text-secondary leading-relaxed mt-0.5">
                      How this status was derived: {stage.derivedFrom}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-secondary tnum">{i + 1}</span>
                </li>
              ))}
            </ol>
            <DataQualitySection report={report} onReady={refreshQuietly} />
            <div className="mt-4">
              <DataStateNote>
                A stage is marked healthy only when its status is known from a real check. Unknown is a valid state and
                is used wherever nothing can be confirmed. Data as of {report.dataAsOf}; checked {report.checkedAt}.
              </DataStateNote>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function StageDot({ status }: { status: StageStatus }) {
  const tone =
    status === 'healthy'
      ? 'bg-category-activity'
      : status === 'degraded'
        ? 'bg-category-attention'
        : 'bg-border';
  return <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${tone}`} aria-hidden="true" />;
}

function StageLabel({ status }: { status: StageStatus }) {
  const variant = status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'default';
  // The word is part of the label, so the state is never conveyed by colour alone.
  return <Badge variant={variant} className="text-[10px]">{STAGE_STATUS_LABEL[status]}</Badge>;
}
