'use client';

// ── Settings → Connections → Oura Ring ──────────────────
//
// The one place a reader connects, checks and disconnects the ring. Settings is
// the only page that names a data source; every other page just shows data.
//
// The status comes from GET /api/sources/oura: configuration state, granted
// scopes and the last failure message. It never contains a token. The card does
// the sign-in by plain navigation to the authorize route, and the disconnect by
// DELETE after an explicit confirm.

import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, Plug, TriangleAlert } from 'lucide-react';
import { Badge, Button, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';

/** The shape GET /api/sources/oura returns. */
export interface OuraStatusView {
  configured: boolean;
  configProblem: string | null;
  connected: boolean;
  scopes: string[];
  missingScopes: string[];
  accessExpiresAt: string | null;
  needsReconnect: boolean;
  lastError: { kind: string; message: string } | null;
}

export type OuraCardState = 'not_configured' | 'ready' | 'connected' | 'needs_reconnect' | 'error';
export type OuraNotice = 'connected' | 'denied' | null;

export const OURA_ENV_VARS = ['OURA_CLIENT_ID', 'OURA_CLIENT_SECRET', 'OURA_REDIRECT_URI', 'VITAL_SECRET_KEY'] as const;
export const OURA_AUTHORIZE_PATH = '/api/sources/oura/authorize';

/** What a scope lets Vital read, in plain words. */
const SCOPE_WORDS: Record<string, string> = {
  daily: 'daily summaries (sleep, activity, readiness)',
  heartrate: 'heart rate',
  workout: 'workouts',
  spo2: 'blood oxygen',
  spo2Daily: 'blood oxygen',
};

function scopeWords(scope: string): string {
  return SCOPE_WORDS[scope] ?? scope;
}

export function ouraCardState(status: OuraStatusView): OuraCardState {
  if (!status.configured) return 'not_configured';
  if (status.needsReconnect) return 'needs_reconnect';
  if (status.lastError) return 'error';
  return status.connected ? 'connected' : 'ready';
}

export function noticeFrom(value: string | null | undefined): OuraNotice {
  return value === 'connected' || value === 'denied' ? value : null;
}

const NOTICE_TEXT: Record<'connected' | 'denied', string> = {
  connected: 'Oura is connected.',
  denied: 'The Oura sign-in was cancelled, so nothing was connected.',
};

const LINK_CLASS =
  'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ' +
  'bg-primary text-primary-text shadow-sm hover:opacity-90 text-sm px-3.5 py-2 rounded-control';

export interface OuraConnectionViewProps {
  status: OuraStatusView | null;
  loadError: string | null;
  notice: OuraNotice;
  confirming: boolean;
  busy: boolean;
  actionError: string | null;
  onAskDisconnect: () => void;
  onCancelDisconnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
}

function StateBadge({ state }: { state: OuraCardState }) {
  switch (state) {
    case 'connected':
      return <Badge variant="success">Connected</Badge>;
    case 'ready':
      return <Badge variant="accent">Ready to connect</Badge>;
    case 'needs_reconnect':
      return <Badge variant="warning">Needs reconnect</Badge>;
    case 'error':
      return <Badge variant="warning">Error</Badge>;
    default:
      return <Badge>Not configured</Badge>;
  }
}

function ConnectLink({ label }: { label: string }) {
  return (
    <a href={OURA_AUTHORIZE_PATH} className={LINK_CLASS}>
      <Plug size={14} aria-hidden="true" />
      <span className="ml-1.5">{label}</span>
    </a>
  );
}

/** Pure presentation: every state is rendered from its props alone. */
export function OuraConnectionView(props: OuraConnectionViewProps) {
  const { status, loadError, notice, confirming, busy, actionError } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The Oura status could not be read"
        message={`${loadError} No connection state is being assumed in its place.`}
        onRetry={props.onRetry}
      />
    );
  }
  if (!status) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Checking the Oura connection</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }

  const state = ouraCardState(status);
  return (
    <div className="space-y-3 text-sm" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={state} />
        {notice && (
          <span role="status" className="text-xs text-text-secondary">
            {NOTICE_TEXT[notice]}
          </span>
        )}
      </div>

      {state === 'not_configured' && (
        <>
          <p className="text-xs text-text-secondary leading-relaxed">
            Oura is not configured. Set these variables on the server, then restart:
          </p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
            {OURA_ENV_VARS.map(name => (
              <li key={name}>
                <code className="text-[11px]">{name}</code>
              </li>
            ))}
          </ul>
          {status.configProblem && <p className="text-xs text-category-attention">{status.configProblem}</p>}
        </>
      )}

      {state === 'ready' && (
        <>
          <p className="text-xs text-text-secondary leading-relaxed">
            Oura is configured but not connected yet. Connecting opens Oura&apos;s own sign-in page; Vital never sees your
            password.
          </p>
          <ConnectLink label="Connect Oura" />
        </>
      )}

      {state === 'needs_reconnect' && (
        <>
          <p className="text-xs text-category-attention flex items-center gap-1.5">
            <TriangleAlert size={12} aria-hidden="true" />
            The stored connection can no longer be used (it was revoked, expired, or written under a different secret
            key). Reconnect to continue.
          </p>
          <ConnectLink label="Reconnect Oura" />
        </>
      )}

      {(state === 'connected' || state === 'error') && (
        <>
          {state === 'error' && status.lastError && (
            <p className="text-xs text-category-attention flex items-center gap-1.5" role="alert">
              <TriangleAlert size={12} aria-hidden="true" />
              {status.lastError.message}
            </p>
          )}
          <p className="text-xs text-text-secondary flex flex-wrap items-center gap-1.5">
            <CircleCheck size={12} aria-hidden="true" />
            Allowed: {status.scopes.length > 0 ? status.scopes.map(scopeWords).join(', ') : 'nothing was reported'}.
          </p>
          {status.missingScopes.length > 0 && (
            <p className="text-xs text-category-attention leading-relaxed">
              Not allowed: {status.missingScopes.map(scopeWords).join(', ')}. Those measures are not read. Disconnect and
              connect again, and allow them, to include them.
            </p>
          )}
          {actionError && (
            <p className="text-xs text-category-attention" role="alert">
              {actionError}
            </p>
          )}
          {!confirming ? (
            <Button variant="secondary" size="sm" onClick={props.onAskDisconnect} disabled={busy}>
              Disconnect
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm disconnect">
              <span className="text-xs text-text-secondary">
                Disconnecting removes the stored connection and Oura&apos;s data from Vital.
              </span>
              <Button variant="danger" size="sm" onClick={props.onDisconnect} disabled={busy}>
                {busy ? 'Disconnecting…' : 'Yes, disconnect'}
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onCancelDisconnect} disabled={busy}>
                Keep it
              </Button>
            </div>
          )}
        </>
      )}

      <DataStateNote>
        Only the encrypted sign-in credential is kept on the server. Oura&apos;s readings are fetched when needed, held
        in memory, and never written to the database or to disk.
      </DataStateNote>
    </div>
  );
}

export interface OuraConnectionProps {
  /** Renders the card heading (the Settings page supplies its own section head). */
  heading?: (title: string) => React.ReactNode;
  /** The `?oura=` value of the page URL. */
  noticeParam?: string | null;
  /** Called after a disconnect so server-rendered data refreshes. */
  onChanged?: () => void;
}

export function OuraConnection({ heading, noticeParam, onChanged }: OuraConnectionProps) {
  const [status, setStatus] = useState<OuraStatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/sources/oura', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The status endpoint answered HTTP ${res.status}.`);
      setStatus((await res.json()) as OuraStatusView);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The Oura status could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/sources/oura', { method: 'DELETE', cache: 'no-store' });
      if (res.status !== 204) throw new Error(`Oura could not be disconnected (HTTP ${res.status}).`);
      setConfirming(false);
      await load();
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Oura could not be disconnected.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {heading ? heading('Oura Ring') : <h2 className="text-base font-semibold text-text-primary mb-5">Oura Ring</h2>}
      <OuraConnectionView
        status={status}
        loadError={loadError}
        notice={noticeFrom(noticeParam)}
        confirming={confirming}
        busy={busy}
        actionError={actionError}
        onAskDisconnect={() => setConfirming(true)}
        onCancelDisconnect={() => setConfirming(false)}
        onDisconnect={() => void disconnect()}
        onRetry={() => void load()}
      />
    </>
  );
}
