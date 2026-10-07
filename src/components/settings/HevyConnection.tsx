'use client';

// ── Settings → Connections → Workout sources → Hevy ───────────────────────────────────────────
//
// The one place a reader connects, changes and disconnects the Hevy API key.
// Settings is the only page that names a data source.
//
// The status comes from GET /api/sources/hevy and never holds the key. The key
// lives in this component only while it is being typed: it is cleared the moment
// Save is pressed, so it is not in state after a submit, in a URL, in
// localStorage or in a log.

import { useCallback, useEffect, useState } from 'react';
import { HEVY_PATH, saveHevy, type HevyStatusView } from './hevy-card';
import type { SyncLine } from './workout-source';
import { HevyConnectionView } from './HevyConnectionView';

export * from './hevy-card';
export { HevyConnectionView, type HevyConnectionViewProps } from './HevyConnectionView';

export interface HevyConnectionProps {
  /** Renders the card heading (the Settings page supplies its own section head). */
  heading?: (title: string) => React.ReactNode;
  /** Called after a successful save or disconnect, so server-rendered data refreshes. */
  onChanged?: (event: 'saved' | 'disconnected') => void;
  /** The source's sync status from the pipeline report, shown in the same card. */
  syncLine?: SyncLine | null;
}

export function HevyConnection({ heading, onChanged, syncLine }: HevyConnectionProps) {
  const [status, setStatus] = useState<HevyStatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(HEVY_PATH, { cache: 'no-store' });
      if (!res.ok) throw new Error(`The status endpoint answered HTTP ${res.status}.`);
      setStatus((await res.json()) as HevyStatusView);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The status could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    // Take the key out of state before anything else: the request gets this local copy only.
    const submitted = apiKey;
    setApiKey('');
    setBusy(true);
    setActionError(null);
    const result = await saveHevy(url, submitted);
    setBusy(false);
    if (!result.ok) {
      setActionError(`${result.message} Enter the key again to retry.`);
      return;
    }
    setStatus(result.status);
    setEditing(false);
    setUrl('');
    onChanged?.('saved');
  };

  const disconnect = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(HEVY_PATH, { method: 'DELETE', cache: 'no-store' });
      if (res.status !== 204) throw new Error(`The connection could not be removed (HTTP ${res.status}).`);
      setConfirming(false);
      await load();
      onChanged?.('disconnected');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The connection could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const openChange = () => {
    setUrl(status?.url ?? '');
    setApiKey('');
    setActionError(null);
    setEditing(true);
  };
  const closeChange = () => {
    setEditing(false);
    setUrl('');
    setApiKey('');
    setActionError(null);
  };

  return (
    <>
      {heading ? heading('Hevy') : <h2 className="text-base font-semibold text-text-primary mb-5">Hevy</h2>}
      <HevyConnectionView
        status={status}
        loadError={loadError}
        editing={editing}
        url={url}
        apiKey={apiKey}
        confirming={confirming}
        busy={busy}
        actionError={actionError}
        onUrlChange={setUrl}
        onApiKeyChange={setApiKey}
        onSave={() => void save()}
        onAskChange={openChange}
        onCancelChange={closeChange}
        onAskDisconnect={() => setConfirming(true)}
        onCancelDisconnect={() => setConfirming(false)}
        onDisconnect={() => void disconnect()}
        onRetry={() => void load()}
        syncLine={syncLine}
      />
    </>
  );
}
