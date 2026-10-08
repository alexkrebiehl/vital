// ── The Health Auto Export card, as pure presentation ───────────────────────
//
// Every state renders from its props alone. The key field is a password input
// that is never given a value from the server: the stored key is shown only as
// its last 4 characters.

import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Badge, Button, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { HAE_KEY_COMMANDS, canSaveHae, haeCardState, maskedKey, type HaeCardState, type HaeStatusView } from './hae-card';

export interface HaeConnectionViewProps {
  status: HaeStatusView | null;
  loadError: string | null;
  /** The Change form is open on a stored connection. */
  editing: boolean;
  endpoint: string;
  apiKey: string;
  confirming: boolean;
  busy: boolean;
  actionError: string | null;
  onEndpointChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onAskChange: () => void;
  onCancelChange: () => void;
  onAskDisconnect: () => void;
  onCancelDisconnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-surface border border-border-strong rounded-control text-text-primary ' +
  'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

function StateBadge({ state }: { state: HaeCardState }) {
  switch (state) {
    case 'connected':
      return <Badge variant="success">Connected</Badge>;
    case 'needs_reentry':
      return <Badge variant="warning">Needs re-entry</Badge>;
    case 'error':
      return <Badge variant="warning">Error</Badge>;
    case 'not_connected':
      return <Badge variant="accent">Not connected</Badge>;
    default:
      return <Badge>Not available</Badge>;
  }
}

function Form(props: HaeConnectionViewProps & { status: HaeStatusView; state: HaeCardState }) {
  const { status, state, editing, busy, endpoint, apiKey } = props;
  const disabled = !status.available || busy;
  const keepsKey = editing && state !== 'needs_reentry';
  return (
    <form
      className="space-y-3"
      onSubmit={event => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Server address</span>
        <input
          type="url"
          className={INPUT_CLASS}
          value={endpoint}
          placeholder="https://your-server:3001"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={event => props.onEndpointChange(event.target.value)}
        />
      </label>
      <label className="block text-xs text-text-secondary space-y-1">
        <span>API key</span>
        <input
          type="password"
          className={INPUT_CLASS}
          value={apiKey}
          placeholder={keepsKey ? 'Leave blank to keep the stored key' : 'Paste the API key'}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          onChange={event => props.onApiKeyChange(event.target.value)}
        />
      </label>
      {props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !canSaveHae(status, editing, endpoint, apiKey)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" size="sm" onClick={props.onCancelChange} disabled={busy}>
            Cancel
          </Button>
        )}
        {busy && <span className="text-xs text-text-secondary">Checking the server before saving…</span>}
      </div>
    </form>
  );
}

function Stored({ props, status, state }: { props: HaeConnectionViewProps; status: HaeStatusView; state: HaeCardState }) {
  const { confirming, busy } = props;
  return (
    <>
      {state === 'error' && status.lastError && (
        <p className="text-xs text-category-attention flex items-center gap-1.5" role="alert">
          <TriangleAlert size={12} aria-hidden="true" />
          {status.lastError.message}
        </p>
      )}
      <dl className="text-xs text-text-secondary space-y-1">
        <div className="flex flex-wrap gap-1.5">
          <dt>Server address:</dt>
          <dd className="text-text-primary break-all">{status.endpoint}</dd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <dt>API key:</dt>
          <dd className="text-text-primary font-mono">{maskedKey(status.keyLast4)}</dd>
        </div>
      </dl>
      {props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={props.onAskChange} disabled={busy}>
            Change
          </Button>
          <Button variant="secondary" size="sm" onClick={props.onAskDisconnect} disabled={busy}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm disconnect">
          <span className="text-xs text-text-secondary">
            Disconnecting removes the stored address and API key from Vital.
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
  );
}

export function HaeConnectionView(props: HaeConnectionViewProps) {
  const { status, loadError, editing } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The Health Auto Export status could not be read"
        message={`${loadError} No connection state is being assumed in its place.`}
        onRetry={props.onRetry}
      />
    );
  }
  if (!status) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Checking the connection</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }

  const state = haeCardState(status);
  const showForm = state === 'not_available' || state === 'not_connected' || state === 'needs_reentry' || editing;
  return (
    <div className="space-y-3 text-sm" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={state} />
      </div>

      {state === 'not_available' && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary leading-relaxed">
            The connection is stored encrypted, and the server has no usable <code className="text-[11px]">VITAL_SECRET_KEY</code>{' '}
            to encrypt it with. Create one, then restart:
          </p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
            {HAE_KEY_COMMANDS.map(command => (
              <li key={command}>
                <code className="text-[11px]">{command}</code>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-secondary">
            <code className="text-[11px]">npm run db:init</code> writes the key for you; the second command prints one to set yourself.
          </p>
        </div>
      )}

      {state === 'needs_reentry' && (
        <p className="text-xs text-category-attention flex items-center gap-1.5">
          <TriangleAlert size={12} aria-hidden="true" />
          The stored connection can no longer be read (it was written under a different secret key). Enter the address and key
          again.
        </p>
      )}

      {state === 'not_connected' && (
        <p className="text-xs text-text-secondary leading-relaxed">
          Enter the address of your Health Auto Export server and its API key. Vital checks the server before it saves anything.
        </p>
      )}

      {(state === 'connected' || state === 'error') && <Stored props={props} status={status} state={state} />}
      {showForm && <Form {...props} status={status} state={state} />}

      {(state === 'connected' || state === 'error') && !showForm && (
        <p className="text-xs text-text-secondary flex items-center gap-1.5">
          <CircleCheck size={12} aria-hidden="true" />
          The key is stored encrypted and is never shown again.
        </p>
      )}

      <DataStateNote>
        The address and key are kept encrypted on the server. The key never reaches the browser after you save it, and Vital
        only reads from your server.
      </DataStateNote>
    </div>
  );
}
