// ── The Hevy card, as pure presentation ─────────────────────────────────────
//
// Every state renders from its props alone. The key field is a password input
// that is never given a value from the server: the stored key is shown only as
// its last 4 characters.

import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Badge, Button, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { HAE_KEY_COMMANDS } from './hae-card';
import { canSaveHevy, hevyCardState, maskedKey, type HevyCardState, type HevyStatusView } from './hevy-card';

export interface HevyConnectionViewProps {
  status: HevyStatusView | null;
  loadError: string | null;
  /** The Change form is open on a stored connection. */
  editing: boolean;
  url: string;
  apiKey: string;
  confirming: boolean;
  busy: boolean;
  actionError: string | null;
  onUrlChange: (value: string) => void;
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

function StateBadge({ state }: { state: HevyCardState }) {
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

function Form(props: HevyConnectionViewProps & { status: HevyStatusView; state: HevyCardState }) {
  const { status, state, editing, busy, url, apiKey } = props;
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
      <label className="block text-xs text-text-secondary space-y-1">
        <span>API address (optional)</span>
        <input
          type="url"
          className={INPUT_CLASS}
          value={url}
          placeholder="Leave blank to use Hevy's own API"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={event => props.onUrlChange(event.target.value)}
        />
      </label>
      {props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !canSaveHevy(status, editing, apiKey)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" size="sm" onClick={props.onCancelChange} disabled={busy}>
            Cancel
          </Button>
        )}
        {busy && <span className="text-xs text-text-secondary">Checking the connection before saving…</span>}
      </div>
    </form>
  );
}

function Stored({ props, status, state }: { props: HevyConnectionViewProps; status: HevyStatusView; state: HevyCardState }) {
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
          <dt>API key:</dt>
          <dd className="text-text-primary font-mono">{maskedKey(status.keyLast4)}</dd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <dt>API address:</dt>
          <dd className="text-text-primary break-all">{status.url ?? "Hevy's own API"}</dd>
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
            Disconnecting removes the stored API key and address from Vital, and drops the workouts read through it.
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

function NotAvailable() {
  return (
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
    </div>
  );
}

export function HevyConnectionView(props: HevyConnectionViewProps) {
  const { status, loadError, editing } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The Hevy status could not be read"
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

  const state = hevyCardState(status);
  const showForm = state === 'not_available' || state === 'not_connected' || state === 'needs_reentry' || editing;
  const stored = state === 'connected' || state === 'error';
  return (
    <div className="space-y-3 text-sm" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={state} />
      </div>

      {state === 'not_available' && <NotAvailable />}

      {state === 'needs_reentry' && (
        <p className="text-xs text-category-attention flex items-center gap-1.5">
          <TriangleAlert size={12} aria-hidden="true" />
          The stored connection can no longer be read (it was written under a different secret key). Enter the key again.
        </p>
      )}

      {state === 'not_connected' && (
        <p className="text-xs text-text-secondary leading-relaxed">
          Paste your Hevy API key (it needs a Hevy Pro account). Vital checks the key before it saves anything.
        </p>
      )}

      {stored && <Stored props={props} status={status} state={state} />}
      {showForm && <Form {...props} status={status} state={state} />}

      {stored && !showForm && (
        <p className="text-xs text-text-secondary flex items-center gap-1.5">
          <CircleCheck size={12} aria-hidden="true" />
          The key is stored encrypted and is never shown again.
        </p>
      )}

      <DataStateNote>
        The key is kept encrypted on the server and never reaches the browser after you save it. Synced sessions stay in the
        server&apos;s memory and are never written to the database.
      </DataStateNote>
    </div>
  );
}
