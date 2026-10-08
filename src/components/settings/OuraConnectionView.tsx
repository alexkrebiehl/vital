// ── The Oura card, as pure presentation ─────────────────────────────────────
//
// Every state renders from its props alone. Settings is the only page that
// names a data source.

import { CircleCheck, Plug, TriangleAlert } from 'lucide-react';
import { Badge, Button, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { OuraAppForm } from './OuraAppForm';
import {
  OURA_AUTHORIZE_PATH,
  OURA_KEY_COMMANDS,
  maskedSecret,
  ouraCardState,
  type OuraAppView,
  type OuraCardState,
  type OuraFormValues,
  type OuraNotice,
  type OuraStatusView,
} from './oura-card';

export interface OuraConnectionViewProps {
  status: OuraStatusView | null;
  app: OuraAppView | null;
  loadError: string | null;
  notice: OuraNotice;
  /** Warnings from the last save (for example a plain http address that is not localhost). */
  warnings: string[];
  editing: boolean;
  form: OuraFormValues;
  confirming: boolean;
  confirmingRemove: boolean;
  busy: boolean;
  actionError: string | null;
  onFormChange: (next: OuraFormValues) => void;
  onSave: () => void;
  onAskChange: () => void;
  onCancelChange: () => void;
  onAskDisconnect: () => void;
  onCancelDisconnect: () => void;
  onDisconnect: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onRetry: () => void;
}

const NOTICE_TEXT: Record<'connected' | 'denied', string> = {
  connected: 'Oura is connected.',
  denied: 'The Oura sign-in was cancelled, so nothing was connected.',
};

const LINK_CLASS =
  'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ' +
  'bg-primary text-primary-text shadow-sm hover:opacity-90 text-sm px-3.5 py-2 rounded-control';

/** What a scope lets Vital read, in plain words. */
const SCOPE_WORDS: Record<string, string> = {
  daily: 'daily summaries (sleep, activity, readiness)',
  heartrate: 'heart rate',
  workout: 'workouts',
  spo2: 'blood oxygen',
  spo2Daily: 'blood oxygen',
  heart_health: 'VO2 max',
};
const scopeWords = (scope: string): string => SCOPE_WORDS[scope] ?? scope;

function StateBadge({ state }: { state: OuraCardState }) {
  switch (state) {
    case 'connected':
      return <Badge variant="success">Connected</Badge>;
    case 'ready':
      return <Badge variant="accent">Ready to connect</Badge>;
    case 'needs_reconnect':
      return <Badge variant="warning">Needs reconnect</Badge>;
    case 'needs_reentry':
      return <Badge variant="warning">Needs re-entry</Badge>;
    case 'error':
      return <Badge variant="warning">Error</Badge>;
    case 'app_missing':
      return <Badge>Not configured</Badge>;
    default:
      return <Badge>Not available</Badge>;
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

function Summary({ app }: { app: OuraAppView }) {
  return (
    <dl className="text-xs text-text-secondary space-y-1">
      <div className="flex flex-wrap gap-1.5">
        <dt>Client ID:</dt>
        <dd className="text-text-primary break-all">{app.clientId}</dd>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <dt>Client secret:</dt>
        <dd className="text-text-primary font-mono">{maskedSecret(app.secretLast4)}</dd>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <dt>Redirect URI:</dt>
        <dd className="text-text-primary break-all">{app.redirectUri}</dd>
      </div>
    </dl>
  );
}

function Confirm(props: { label: string; text: string; yes: string; no: string; busyText: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={props.label}>
      <span className="text-xs text-text-secondary">{props.text}</span>
      <Button variant="danger" size="sm" onClick={props.onYes} disabled={props.busy}>
        {props.busy ? props.busyText : props.yes}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onNo} disabled={props.busy}>
        {props.no}
      </Button>
    </div>
  );
}

/** Pure presentation: every state is rendered from its props alone. */
export function OuraConnectionView(props: OuraConnectionViewProps) {
  const { status, app, loadError, notice, confirming, confirmingRemove, busy, actionError, editing } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The Oura status could not be read"
        message={`${loadError} No connection state is being assumed in its place.`}
        onRetry={props.onRetry}
      />
    );
  }
  if (!status || !app) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Checking the Oura connection</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }

  const state = ouraCardState(status, app);
  const showForm = state === 'not_available' || state === 'app_missing' || state === 'needs_reentry' || editing;
  const stored = !showForm && (state === 'ready' || state === 'connected' || state === 'needs_reconnect' || state === 'error');
  const loggedIn = state === 'connected' || state === 'error';
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

      {state === 'not_available' && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary leading-relaxed">
            The Oura app credentials are stored encrypted, and the server has no usable{' '}
            <code className="text-[11px]">VITAL_SECRET_KEY</code> to encrypt them with. Create one, then restart:
          </p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
            {OURA_KEY_COMMANDS.map(command => (
              <li key={command}>
                <code className="text-[11px]">{command}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state === 'app_missing' && (
        <p className="text-xs text-text-secondary leading-relaxed">
          Enter the client ID, client secret and redirect URI of your Oura app, then connect. They are stored encrypted.
        </p>
      )}
      {state === 'needs_reentry' && (
        <p className="text-xs text-category-attention flex items-center gap-1.5">
          <TriangleAlert size={12} aria-hidden="true" />
          The stored credentials cannot be read (they were written under a different secret key). Enter them again.
        </p>
      )}

      {showForm && (
        <OuraAppForm
          app={app}
          editing={editing}
          form={props.form}
          busy={busy}
          actionError={actionError}
          onFormChange={props.onFormChange}
          onSave={props.onSave}
          onCancelChange={props.onCancelChange}
        />
      )}

      {props.warnings.map(warning => (
        <p key={warning} className="text-xs text-category-attention" role="status">
          {warning}
        </p>
      ))}

      {stored && (
        <>
          {state === 'needs_reconnect' && (
            <p className="text-xs text-category-attention flex items-center gap-1.5">
              <TriangleAlert size={12} aria-hidden="true" />
              The stored Oura login was issued for a different client ID, or can no longer be used. It has been kept;
              reconnect to continue.
            </p>
          )}
          {state === 'error' && status.lastError && (
            <p className="text-xs text-category-attention flex items-center gap-1.5" role="alert">
              <TriangleAlert size={12} aria-hidden="true" />
              {status.lastError.message}
            </p>
          )}
          <Summary app={app} />
          {state === 'ready' && (
            <p className="text-xs text-text-secondary leading-relaxed">
              Connecting opens Oura&apos;s own sign-in page; Vital never sees your password.
            </p>
          )}
          {loggedIn && (
            <>
              <p className="text-xs text-text-secondary flex flex-wrap items-center gap-1.5">
                <CircleCheck size={12} aria-hidden="true" />
                Allowed: {status.scopes.length > 0 ? status.scopes.map(scopeWords).join(', ') : 'nothing was reported'}.
              </p>
              {status.missingScopes.length > 0 && (
                <p className="text-xs text-category-attention leading-relaxed">
                  Not allowed: {status.missingScopes.map(scopeWords).join(', ')}. Those measures are not read. Disconnect
                  and connect again, and allow them, to include them.
                </p>
              )}
            </>
          )}
          {actionError && (
            <p className="text-xs text-category-attention" role="alert">
              {actionError}
            </p>
          )}
          {confirming ? (
            <Confirm
              label="Confirm disconnect"
              text="Disconnecting removes the stored connection and Oura's data from Vital."
              yes="Yes, disconnect"
              no="Keep it"
              busyText="Disconnecting…"
              busy={busy}
              onYes={props.onDisconnect}
              onNo={props.onCancelDisconnect}
            />
          ) : confirmingRemove ? (
            <Confirm
              label="Confirm remove"
              text="Removing the credentials also disconnects Oura, because it cannot connect without them."
              yes="Yes, remove"
              no="Keep them"
              busyText="Removing…"
              busy={busy}
              onYes={props.onRemove}
              onNo={props.onCancelRemove}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {!loggedIn && <ConnectLink label={state === 'needs_reconnect' ? 'Reconnect Oura' : 'Connect Oura'} />}
              <Button variant="secondary" size="sm" onClick={props.onAskChange} disabled={busy}>
                Change
              </Button>
              {loggedIn && (
                <Button variant="secondary" size="sm" onClick={props.onAskDisconnect} disabled={busy}>
                  Disconnect
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={props.onAskRemove} disabled={busy}>
                Remove credentials
              </Button>
            </div>
          )}
        </>
      )}

      <DataStateNote>
        Only encrypted credentials and the sign-in credential are kept on the server. Oura&apos;s readings are fetched
        when needed, held in memory, and never written to the database or to disk.
      </DataStateNote>
    </div>
  );
}
