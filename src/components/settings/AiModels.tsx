'use client';

// ── Settings → Preferences → AI models ──────────────────────────────────
//
// Which provider and model each AI feature runs on, chosen from the providers
// added in Connections → AI providers, with the tuning for each tucked under
// Advanced. Each use saves on its own, guarded by its revision: a choice changed
// in another tab is refused and the current one shown, never overwritten.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, DataStateNote, ErrorState, Select, Skeleton } from '@/components/ui/primitives';
import { AI_PROVIDER_KIND_LABELS, AI_USE_LABELS, AI_USES, type AiUse } from '@/lib/ai/types';
import { AI_PROVIDERS_PATH, type AiProvidersBody, type AiProviderStatus } from './ai-providers-card';
import {
  AI_ASSIGNMENTS_PATH,
  OPTION_FIELDS,
  USE_DESCRIPTIONS,
  canSaveUse,
  draftFromStatus,
  fieldProblem,
  modelsPath,
  saveUse,
  type AiAssignmentsBody,
  type UseDraft,
} from './ai-models-card';

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-surface border border-border-strong rounded-control text-text-primary ' +
  'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

/** The Select value that means "type the model id". */
const OTHER = '__other__';

interface ModelList {
  models: string[];
  note: string | null;
  loading: boolean;
}

const NONE_LABEL: Record<AiUse, string> = {
  analyst: 'None — the built-in demo analyst',
  summary: 'None — computed from your data',
  summary_fallback: 'None',
};

export function AiModels() {
  const [providers, setProviders] = useState<AiProvidersBody | null>(null);
  const [assignments, setAssignments] = useState<AiAssignmentsBody | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lists, setLists] = useState<Record<string, ModelList>>({});
  const [justSaved, setJustSaved] = useState<AiUse | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [p, a] = await Promise.all([
        fetch(AI_PROVIDERS_PATH, { cache: 'no-store' }),
        fetch(AI_ASSIGNMENTS_PATH, { cache: 'no-store' }),
      ]);
      if (!p.ok || !a.ok) throw new Error(`The AI settings endpoints answered HTTP ${p.ok ? a.status : p.status}.`);
      setProviders((await p.json()) as AiProvidersBody);
      setAssignments((await a.json()) as AiAssignmentsBody);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The AI settings could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fetch a provider's model list once per visit. */
  const ensureList = useCallback((providerId: string) => {
    if (!providerId) return;
    setLists(current => {
      if (current[providerId]) return current;
      void fetch(modelsPath(providerId), { cache: 'no-store' })
        .then(async res => {
          const body = res.ok ? ((await res.json()) as { models?: string[]; note?: string | null }) : null;
          setLists(now => ({
            ...now,
            [providerId]: {
              models: body?.models ?? [],
              note: body ? body.note ?? null : `The model list could not be read (HTTP ${res.status}). Type the model id.`,
              loading: false,
            },
          }));
        })
        .catch(() =>
          setLists(now => ({ ...now, [providerId]: { models: [], note: 'The model list could not be read. Type the model id.', loading: false } }))
        );
      return { ...current, [providerId]: { models: [], note: null, loading: true } };
    });
  }, []);

  if (loadError) {
    return <ErrorState title="The AI model choices could not be read" message={loadError} onRetry={() => void load()} />;
  }
  if (!providers || !assignments) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Reading the AI model choices</span>
        <Skeleton height={16} width="40%" />
        <Skeleton height={48} />
      </div>
    );
  }
  if (!providers.database) {
    return (
      <DataStateNote tone="attention">
        AI model choices are stored in the database, and none is configured. The Analyst answers from the built-in demo and the
        Summary is computed from your data.
      </DataStateNote>
    );
  }
  if (providers.providers.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No AI provider is set up yet.{' '}
        <Link href="/settings?tab=connections" className="text-primary hover:underline">
          Add one in Connections
        </Link>
        , then choose a model for each feature here. Until then the Analyst answers from the built-in demo and the Summary is
        computed from your data.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {AI_USES.map(use => (
        <UseBlock
          key={`${use}:${assignments.assignments[use]?.revision ?? 0}`}
          use={use}
          providers={providers.providers}
          initial={draftFromStatus(assignments.assignments[use])}
          lists={lists}
          ensureList={ensureList}
          justSaved={justSaved === use}
          onSaved={body => {
            setAssignments(body);
            setJustSaved(use);
          }}
        />
      ))}
      <DataStateNote>
        The system prompt and the request timeouts are deployment settings, set by whoever runs this server.
      </DataStateNote>
    </div>
  );
}

interface UseBlockProps {
  use: AiUse;
  providers: AiProviderStatus[];
  initial: UseDraft;
  lists: Record<string, ModelList>;
  ensureList: (providerId: string) => void;
  /** This use was the last one saved, so the block (remounted with the new revision) says so. */
  justSaved: boolean;
  onSaved: (body: AiAssignmentsBody) => void;
}

function UseBlock({ use, providers, initial, lists, ensureList, justSaved, onSaved }: UseBlockProps) {
  const [draft, setDraft] = useState<UseDraft>(initial);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    ensureList(draft.providerId);
  }, [draft.providerId, ensureList]);

  const list = draft.providerId ? lists[draft.providerId] : undefined;
  const listed = list?.models ?? [];
  const showTyped = typing || (list !== undefined && !list.loading && listed.length === 0) || (draft.model !== '' && listed.length > 0 && !listed.includes(draft.model));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const id = `ai-${use}`;

  const set = (patch: Partial<UseDraft>) => {
    setMessage(null);
    setDraft(current => ({ ...current, ...patch }));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await saveUse(use, draft);
    setBusy(false);
    if (result.ok) {
      onSaved(result.body);
      return;
    }
    if (result.current !== undefined) {
      // Changed elsewhere: show what is stored now, and say so.
      setDraft(draftFromStatus(result.current));
      setTyping(false);
    }
    setMessage({ tone: 'error', text: result.message });
  };

  const providerOptions = [
    { value: '', label: NONE_LABEL[use] },
    ...providers.map(p => ({ value: p.id, label: `${p.name} (${AI_PROVIDER_KIND_LABELS[p.kind]})` })),
  ];
  const modelOptions = [
    ...(list?.loading ? [{ value: '', label: 'Reading the model list…' }] : [{ value: '', label: 'Choose a model' }]),
    ...listed.map(m => ({ value: m, label: m })),
    { value: OTHER, label: 'Other (type the model id)…' },
  ];

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3" data-use={use}>
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
          {AI_USE_LABELS[use]}
        </h3>
        <p className="text-xs text-text-secondary">{USE_DESCRIPTIONS[use]}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-text-secondary space-y-1">
          <span>Provider</span>
          <Select
            className="w-full"
            aria-label={`${AI_USE_LABELS[use]} provider`}
            value={draft.providerId}
            options={providerOptions}
            onChange={providerId => {
              setTyping(false);
              set({ providerId, model: '' });
            }}
          />
        </label>
        {draft.providerId && (
          <div className="block text-xs text-text-secondary space-y-1">
            <label htmlFor={`${id}-model`}>Model</label>
            {showTyped ? (
              <input
                id={`${id}-model`}
                type="text"
                className={INPUT_CLASS}
                value={draft.model}
                placeholder="Model id, e.g. gpt-5-mini"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                onChange={event => set({ model: event.target.value })}
              />
            ) : (
              <Select
                className="w-full"
                aria-label={`${AI_USE_LABELS[use]} model`}
                value={draft.model}
                options={modelOptions}
                onChange={model => {
                  if (model === OTHER) {
                    setTyping(true);
                    set({ model: '' });
                  } else set({ model });
                }}
              />
            )}
            {list?.note && <p className="text-xs text-text-secondary">{list.note}</p>}
            {showTyped && listed.length > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  setTyping(false);
                  set({ model: '' });
                }}
              >
                Choose from the list instead
              </button>
            )}
          </div>
        )}
      </div>

      {draft.providerId && use === 'analyst' && (
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={draft.labAssist}
            onChange={event => set({ labAssist: event.target.checked })}
          />
          <span>
            <span className="text-text-primary">Read unfamiliar lab reports with this model.</span> When a lab PDF&apos;s layout
            isn&apos;t recognised, its text (with your name and other identifying lines removed) is sent to this model. Off: a lab
            upload never contacts a model.
          </span>
        </label>
      )}

      {draft.providerId && (
        <details className="rounded-control border border-border p-3">
          <summary className="text-xs text-text-secondary cursor-pointer select-none">Advanced</summary>
          <p className="text-xs text-text-secondary mt-2">Leave a field blank to use the default shown in it.</p>
          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            {OPTION_FIELDS[use].map(field => {
              const value = draft.options[field.key] ?? '';
              const problem = fieldProblem(field, value);
              const setValue = (v: string) => set({ options: { ...draft.options, [field.key]: v } });
              return (
                <label key={field.key} className="block text-xs text-text-secondary space-y-1">
                  <span>{field.label}</span>
                  {field.type === 'number' ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      className={INPUT_CLASS}
                      value={value}
                      placeholder={field.placeholder}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      aria-invalid={problem ? true : undefined}
                      onChange={event => setValue(event.target.value)}
                    />
                  ) : (
                    <Select className="w-full" aria-label={field.label} value={value} options={field.choices} onChange={setValue} />
                  )}
                  {problem && <span className="block text-category-attention">{problem}</span>}
                </label>
              );
            })}
          </div>
        </details>
      )}

      {message && (
        <p className={`text-xs ${message.tone === 'error' ? 'text-category-attention' : 'text-text-secondary'}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy || !dirty || !canSaveUse(use, draft)} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {justSaved && !dirty && !message && (
          <span className="text-xs text-text-secondary" role="status">
            Saved.
          </span>
        )}
        {dirty && !busy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(initial);
              setTyping(false);
              setMessage(null);
            }}
          >
            Undo changes
          </Button>
        )}
      </div>
    </section>
  );
}
