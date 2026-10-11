// ── The AI providers card, as pure presentation ─────────────────────────
//
// Every state renders from its props alone. The key field is a password input
// that is never given a value from the server: a stored key is shown only as
// its last 4 characters.

import { TriangleAlert } from 'lucide-react';
import { Badge, Button, ChoiceButton, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { AI_PROVIDER_KIND_LABELS, AI_USE_LABELS } from '@/lib/ai/types';
import {
  ADDRESS_HINTS,
  canSaveDraft,
  isLocalAddress,
  type AiProviderDraft,
  type AiProvidersBody,
  type AiProviderStatus,
} from './ai-providers-card';
import { HAE_KEY_COMMANDS, maskedKey } from './hae-card';

export interface AiProvidersViewProps {
  body: AiProvidersBody | null;
  loadError: string | null;
  /** The add/change form, when open. */
  draft: AiProviderDraft | null;
  /** The stored provider the form is changing, if any. */
  stored: AiProviderStatus | null;
  confirmingId: string | null;
  busy: boolean;
  actionError: string | null;
  notice: string | null;
  onDraftChange: (draft: AiProviderDraft) => void;
  onAdd: () => void;
  onEdit: (provider: AiProviderStatus) => void;
  onCancel: () => void;
  onSave: () => void;
  onAskRemove: (id: string) => void;
  onCancelRemove: () => void;
  onRemove: (id: string) => void;
  onRetry: () => void;
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-surface border border-border-strong rounded-control text-text-primary ' +
  'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

function usedByText(provider: AiProviderStatus): string {
  return provider.usedBy.map(use => AI_USE_LABELS[use]).join(', ');
}

function Form(props: AiProvidersViewProps & { draft: AiProviderDraft; body: AiProvidersBody }) {
  const { draft, stored, body, busy } = props;
  const set = (patch: Partial<AiProviderDraft>) => props.onDraftChange({ ...draft, ...patch });
  const local = isLocalAddress(draft.baseUrl);
  const keepsKey = Boolean(stored?.hasKey && !stored.needsReentry && !draft.removeKey);
  const keyPlaceholder = keepsKey
    ? 'Leave blank to keep the stored key'
    : local
      ? 'Optional for a server on this machine'
      : 'Paste the API key';
  return (
    <form
      className="space-y-3 rounded-control border border-border p-4"
      aria-label={draft.id ? `Change ${stored?.name ?? 'provider'}` : 'Add an AI provider'}
      onSubmit={event => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Name</span>
        <input
          type="text"
          className={INPUT_CLASS}
          value={draft.name}
          placeholder="OpenRouter"
          maxLength={60}
          autoComplete="off"
          disabled={busy}
          onChange={event => set({ name: event.target.value })}
        />
      </label>
      <div className="space-y-1">
        <span className="block text-xs text-text-secondary">Type</span>
        <div className="flex flex-wrap gap-2">
          {(['openai', 'anthropic'] as const).map(kind => (
            <ChoiceButton key={kind} active={draft.kind === kind} onClick={() => set({ kind })} label={AI_PROVIDER_KIND_LABELS[kind]} />
          ))}
        </div>
        <p className="text-xs text-text-secondary">
          OpenAI-compatible covers OpenAI, OpenRouter, LM Studio, Ollama, llama.cpp, vLLM and most other servers.
        </p>
      </div>
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Address</span>
        <input
          type="url"
          className={INPUT_CLASS}
          value={draft.baseUrl}
          placeholder={draft.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://openrouter.ai/api/v1'}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={event => set({ baseUrl: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-1.5" aria-label="Common addresses">
        {ADDRESS_HINTS.map(hint => (
          <button
            key={hint.label}
            type="button"
            className="text-[11px] px-2 py-1 rounded-control border border-border text-text-secondary hover:text-text-primary"
            disabled={busy}
            onClick={() => set({ kind: hint.kind, baseUrl: hint.url, name: draft.name || hint.label })}
          >
            {hint.label}
          </button>
        ))}
      </div>
      <label className="block text-xs text-text-secondary space-y-1">
        <span>API key</span>
        <input
          type="password"
          className={INPUT_CLASS}
          value={draft.apiKey}
          placeholder={keyPlaceholder}
          autoComplete="new-password"
          spellCheck={false}
          disabled={busy || !body.available}
          onChange={event => set({ apiKey: event.target.value })}
        />
      </label>
      {stored?.hasKey && local && (
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={draft.removeKey}
            disabled={busy}
            onChange={event => set({ removeKey: event.target.checked, apiKey: '' })}
          />
          Remove the stored key (this server needs none)
        </label>
      )}
      {props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !canSaveDraft(draft, stored, body.available)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={props.onCancel} disabled={busy}>
          Cancel
        </Button>
        {busy && <span className="text-xs text-text-secondary">Checking the server before saving…</span>}
      </div>
    </form>
  );
}

function Row({ props, provider }: { props: AiProvidersViewProps; provider: AiProviderStatus }) {
  const confirming = props.confirmingId === provider.id;
  return (
    <li className="py-3 space-y-2" data-provider={provider.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{provider.name}</span>
        <Badge>{AI_PROVIDER_KIND_LABELS[provider.kind]}</Badge>
        {provider.usedBy.length > 0 && <Badge variant="accent">Used by {usedByText(provider)}</Badge>}
        {provider.needsReentry && <Badge variant="warning">Key needs re-entry</Badge>}
      </div>
      <dl className="text-xs text-text-secondary space-y-1">
        <div className="flex flex-wrap gap-1.5">
          <dt>Address:</dt>
          <dd className="text-text-primary break-all">{provider.baseUrl}</dd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <dt>API key:</dt>
          <dd className="text-text-primary font-mono">
            {provider.hasKey ? maskedKey(provider.keyLast4) : provider.loopback ? 'none (on this machine)' : 'none'}
          </dd>
        </div>
      </dl>
      {provider.needsReentry && (
        <p className="text-xs text-category-attention flex items-center gap-1.5">
          <TriangleAlert size={12} aria-hidden="true" />
          The stored key can no longer be read (it was written under a different secret key). Change the provider and enter it
          again.
        </p>
      )}
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => props.onEdit(provider)} disabled={props.busy}>
            Change
          </Button>
          <Button variant="secondary" size="sm" onClick={() => props.onAskRemove(provider.id)} disabled={props.busy}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm removing ${provider.name}`}>
          <span className="text-xs text-text-secondary">
            {provider.usedBy.length > 0
              ? `Removing it deletes its address and key, and the ${usedByText(provider)} will have no model until you choose another.`
              : 'Removing it deletes its address and key from Vital.'}
          </span>
          <Button variant="danger" size="sm" onClick={() => props.onRemove(provider.id)} disabled={props.busy}>
            {props.busy ? 'Removing…' : 'Yes, remove'}
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onCancelRemove} disabled={props.busy}>
            Keep it
          </Button>
        </div>
      )}
      {confirming && props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
    </li>
  );
}

export function AiProvidersView(props: AiProvidersViewProps) {
  const { body, loadError, draft } = props;

  if (loadError) {
    return (
      <ErrorState
        title="The AI providers could not be read"
        message={`${loadError} No provider is being assumed in their place.`}
        onRetry={props.onRetry}
      />
    );
  }
  if (!body) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Reading the AI providers</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }

  if (!body.database) {
    return (
      <DataStateNote tone="attention">
        AI providers are stored in the database, and none is configured. Set up Postgres (see the configuration guide) to add
        one; until then the Analyst answers from the built-in demo and the Summary is computed from your data.
      </DataStateNote>
    );
  }

  const adding = draft !== null && draft.id === null;
  return (
    <div className="space-y-3 text-sm">
      {!body.available && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary leading-relaxed">
            API keys are stored encrypted, and the server has no usable <code className="text-[11px]">VITAL_SECRET_KEY</code> to
            encrypt them with. A server on this machine that needs no key can still be added. Create one, then restart:
          </p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
            {HAE_KEY_COMMANDS.map(command => (
              <li key={command}>
                <code className="text-[11px]">{command}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {body.providers.length === 0 && !adding && (
        <p className="text-xs text-text-secondary leading-relaxed">
          No AI provider yet. Add the model server the Analyst and the Summary should use: a hosted service with its API key, or a
          server on this machine. Vital checks the server before it saves anything.
        </p>
      )}

      {body.providers.length > 0 && (
        <ul className="list-none p-0 m-0 divide-y divide-border">
          {body.providers.map(provider =>
            draft?.id === provider.id ? (
              <li key={provider.id} className="py-3">
                <Form {...props} draft={draft} body={body} />
              </li>
            ) : (
              <Row key={provider.id} props={props} provider={provider} />
            )
          )}
        </ul>
      )}

      {adding && <Form {...props} draft={draft} body={body} />}

      {props.notice && (
        <p className="text-xs text-text-secondary" role="status">
          {props.notice}
        </p>
      )}

      {!draft && (
        <Button variant="secondary" size="sm" onClick={props.onAdd} disabled={props.busy}>
          Add provider
        </Button>
      )}

      <DataStateNote>
        Keys are kept encrypted on the server and never reach the browser after you save them. Which provider and model each
        feature uses is chosen in Preferences → AI models.
      </DataStateNote>
    </div>
  );
}
