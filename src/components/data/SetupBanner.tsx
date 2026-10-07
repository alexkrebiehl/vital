'use client';

// ── Setup banner (Settings, above the tabs) ──────────────
//
// Shown only in setup mode. It says why nothing is shown yet, in the layout's
// source-neutral words, and offers a retry. It never offers demo data in place of
// a failed live read.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, Card, DataStateNote } from '@/components/ui/primitives';
import { useSetupFailure, type SetupFailure } from './setup-mode';

export function SetupBannerView({
  failure,
  retrying,
  onRetry,
}: {
  failure: SetupFailure;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Card className="p-5" role="alert">
      <div className="flex items-start gap-3">
        <TriangleAlert size={18} className="text-category-attention shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-text-primary">{failure.title}</h2>
          <p className="text-sm text-text-secondary leading-relaxed">{failure.message}</p>
          {failure.hint && <DataStateNote tone="attention">{failure.hint}</DataStateNote>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
            <span className="text-[11px] text-text-secondary">
              Demo data is deliberately not substituted for a failed live read.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Renders nothing outside setup mode. */
export function SetupBanner() {
  const failure = useSetupFailure();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  if (!failure) return null;

  const retry = () => {
    setRefreshing(true);
    startTransition(() => {
      router.refresh();
      setTimeout(() => setRefreshing(false), 800);
    });
  };
  return <SetupBannerView failure={failure} retrying={pending || refreshing} onRetry={retry} />;
}
