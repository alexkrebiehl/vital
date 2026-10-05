'use client';

// ── Settings → Connections → Removed sources ────────────────
//
// Plan §C5. A source that was removed (its configuration emptied, an OAuth
// source disconnected, the last lab report deleted) is never shown again: everything
// the analyst said from it is hidden at once. This panel is the one place that
// says what is waiting to be deleted, and when, and lets the reader delete it
// now. Settings is the only page that names a data source.
//
// Nothing is listed when no source was removed. The list carries source names,
// dates and counts only — never a value.

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Card, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';

/** The shape GET /api/sources/removed returns. */
export interface RemovedSourceRow {
  id: string;
  name: string;
  removedAt: string;
  purgeOn: string;
  hiddenConversations: number;
}
export interface RemovedSourcesPayload {
  graceDays: number;
  sources: RemovedSourceRow[];
}

/** `2026-10-04` from an ISO timestamp: stable, locale-free. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function conversationsPhrase(count: number): string {
  if (count === 0) return 'No conversations are hidden';
  return `${count} conversation${count === 1 ? ' is' : 's are'} hidden`;
}

export interface RemovedSourcesViewProps {
  data: RemovedSourcesPayload | null;
  loadError: string | null;
  /** The id awaiting confirmation, if any. */
  confirmingId: string | null;
  /** The id being deleted, if any. */
  busyId: string | null;
  actionError: string | null;
  onAsk: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
}

/** Pure presentation: every state is rendered from its props alone. */
export function RemovedSourcesView(props: RemovedSourcesViewProps) {
  const { data, loadError, confirmingId, busyId, actionError } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The removed sources could not be read"
        message={loadError}
        onRetry={props.onRetry}
      />
    );
  }
  if (!data) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Checking for removed sources</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }
  if (data.sources.length === 0) return null;

  return (
    <div className="space-y-3 text-sm" data-testid="removed-sources">
      <p className="text-xs text-text-secondary leading-relaxed">
        These sources were removed. Everything derived from them is already hidden, as if they had never been connected.
        It is deleted for good after {data.graceDays} day{data.graceDays === 1 ? '' : 's'}, or now.
      </p>
      {actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {actionError}
        </p>
      )}
      <ul className="list-none p-0 m-0 space-y-3">
        {data.sources.map(source => (
          <li key={source.id} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-source={source.id}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text-primary">{source.name}</p>
              <p className="text-xs text-text-secondary">
                Removed {dayOf(source.removedAt)} · {conversationsPhrase(source.hiddenConversations)} · deleted
                automatically on {dayOf(source.purgeOn)}
              </p>
            </div>
            {confirmingId === source.id ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm deleting ${source.name}`}>
                <span className="text-xs text-text-secondary">This cannot be undone.</span>
                <Button variant="danger" size="sm" onClick={() => props.onDelete(source.id)} disabled={busyId !== null}>
                  {busyId === source.id ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button variant="ghost" size="sm" onClick={props.onCancel} disabled={busyId !== null}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => props.onAsk(source.id)} disabled={busyId !== null}>
                <Trash2 size={14} aria-hidden="true" />
                <span className="ml-1.5">Delete now</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      <DataStateNote>
        Only conversations and the stored sign-in are kept for a source. Deleting them removes every trace of it from the
        database.
      </DataStateNote>
    </div>
  );
}

export interface RemovedSourcesProps {
  /** Renders the card heading (the Settings page supplies its own section head). */
  heading?: (title: string) => React.ReactNode;
  /** Called after a deletion so server-rendered data refreshes. */
  onChanged?: () => void;
}

/** The card, or nothing at all when no source was removed. */
export function RemovedSources({ heading, onChanged }: RemovedSourcesProps) {
  const [data, setData] = useState<RemovedSourcesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/sources/removed', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The endpoint answered HTTP ${res.status}.`);
      setData((await res.json()) as RemovedSourcesPayload);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The removed sources could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(id)}/data?confirm=yes`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`The data could not be deleted (HTTP ${res.status}).`);
      setConfirmingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The data could not be deleted.');
    } finally {
      setBusyId(null);
    }
  };

  // Nothing to show, nothing to say: the card appears only when there is
  // something to delete (or a failure to read the list), never while loading.
  if (!loadError && (!data || data.sources.length === 0)) return null;

  return (
    <Card className="p-6">
      {heading ? heading('Removed sources') : <h2 className="text-base font-semibold text-text-primary mb-5">Removed sources</h2>}
      <RemovedSourcesView
        data={data}
        loadError={loadError}
        confirmingId={confirmingId}
        busyId={busyId}
        actionError={actionError}
        onAsk={setConfirmingId}
        onCancel={() => setConfirmingId(null)}
        onDelete={id => void remove(id)}
        onRetry={() => void load()}
      />
    </Card>
  );
}
