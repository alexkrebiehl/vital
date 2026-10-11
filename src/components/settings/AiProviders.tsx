'use client';

// ── Settings → Connections → AI providers ───────────────────────────────
//
// Where a person adds, changes and removes the AI model servers their Analyst
// and Summary can run on (the choice itself is made in Preferences → AI models).
//
// The list comes from GET /api/ai/providers and never holds a key. A key lives
// in this component only while it is being typed: it is cleared the moment Save
// is pressed, so it is not in state after a submit, in a URL, in localStorage or
// in a log.

import { useCallback, useEffect, useState } from 'react';
import {
  AI_PROVIDERS_PATH,
  draftFor,
  emptyDraft,
  removeAiProvider,
  saveAiProvider,
  type AiProviderDraft,
  type AiProvidersBody,
} from './ai-providers-card';
import { AiProvidersView } from './AiProvidersView';

export interface AiProvidersProps {
  heading?: (title: string) => React.ReactNode;
}

export function AiProviders({ heading }: AiProvidersProps) {
  const [body, setBody] = useState<AiProvidersBody | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiProviderDraft | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(AI_PROVIDERS_PATH, { cache: 'no-store' });
      if (!res.ok) throw new Error(`The providers endpoint answered HTTP ${res.status}.`);
      setBody((await res.json()) as AiProvidersBody);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The AI providers could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    // Take the key out of state before anything else: the request gets this local copy only.
    const submitted = draft;
    setDraft({ ...draft, apiKey: '' });
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const result = await saveAiProvider(submitted);
    setBusy(false);
    if (!result.ok) {
      setActionError(submitted.apiKey ? `${result.message} Enter the key again to retry.` : result.message);
      return;
    }
    setBody(result.body);
    setDraft(null);
    setNotice(
      result.note ??
        (result.models.length > 0
          ? `Saved. The server offers ${result.models.length} model${result.models.length === 1 ? '' : 's'}; choose one in Preferences → AI models.`
          : 'Saved.')
    );
  };

  const remove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const result = await removeAiProvider(id);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setConfirmingId(null);
    await load();
  };

  const providers = body?.providers ?? [];
  const stored = draft?.id ? providers.find(p => p.id === draft.id) ?? null : null;

  return (
    <>
      {heading ? heading('AI providers') : <h2 className="text-base font-semibold text-text-primary mb-5">AI providers</h2>}
      <AiProvidersView
        body={body}
        loadError={loadError}
        draft={draft}
        stored={stored}
        confirmingId={confirmingId}
        busy={busy}
        actionError={actionError}
        notice={notice}
        onDraftChange={setDraft}
        onAdd={() => {
          setActionError(null);
          setNotice(null);
          setConfirmingId(null);
          setDraft(emptyDraft());
        }}
        onEdit={provider => {
          setActionError(null);
          setNotice(null);
          setConfirmingId(null);
          setDraft(draftFor(provider));
        }}
        onCancel={() => {
          setDraft(null);
          setActionError(null);
        }}
        onSave={() => void save()}
        onAskRemove={id => {
          setActionError(null);
          setDraft(null);
          setConfirmingId(id);
        }}
        onCancelRemove={() => setConfirmingId(null)}
        onRemove={id => void remove(id)}
        onRetry={() => void load()}
      />
    </>
  );
}
