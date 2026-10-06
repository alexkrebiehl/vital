'use client';

// ── Settings → Connections → Oura Ring ──────────────────
//
// The one place a reader enters the Oura app credentials, connects, changes and
// disconnects the ring. Settings is the only page that names a data source.
//
// Two statuses are read: GET /api/sources/oura (the login: scopes, last failure)
// and GET /api/sources/oura/app (the credentials: client ID, last 4 of the
// secret, redirect URI). Neither holds a token or the secret. The secret lives
// in this component only while it is being typed: it is cleared the moment Save
// is pressed, so it is not in state after a submit, in a URL, in localStorage or
// in a log. Connect is plain navigation to the authorize route.

import { useCallback, useEffect, useState } from 'react';
import {
  OURA_APP_PATH,
  OURA_PATH,
  defaultRedirectUri,
  noticeFrom,
  saveOuraApp,
  type OuraAppView,
  type OuraFormValues,
  type OuraStatusView,
} from './oura-card';
import { OuraConnectionView } from './OuraConnectionView';

export * from './oura-card';
export { OuraConnectionView, type OuraConnectionViewProps } from './OuraConnectionView';

export interface OuraConnectionProps {
  /** Renders the card heading (the Settings page supplies its own section head). */
  heading?: (title: string) => React.ReactNode;
  /** The `?oura=` value of the page URL. */
  noticeParam?: string | null;
  /** Called after a save, remove or disconnect so server-rendered data refreshes. */
  onChanged?: () => void;
}

const EMPTY: OuraFormValues = { clientId: '', clientSecret: '', redirectUri: '' };

export function OuraConnection({ heading, noticeParam, onChanged }: OuraConnectionProps) {
  const [status, setStatus] = useState<OuraStatusView | null>(null);
  const [app, setApp] = useState<OuraAppView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OuraFormValues>(EMPTY);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [loginRes, appRes] = await Promise.all([
        fetch(OURA_PATH, { cache: 'no-store' }),
        fetch(OURA_APP_PATH, { cache: 'no-store' }),
      ]);
      if (!loginRes.ok) throw new Error(`The status endpoint answered HTTP ${loginRes.status}.`);
      if (!appRes.ok) throw new Error(`The credentials endpoint answered HTTP ${appRes.status}.`);
      setStatus((await loginRes.json()) as OuraStatusView);
      setApp((await appRes.json()) as OuraAppView);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The Oura status could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Prefill the redirect URI from the address this page is loaded from. Done after mount,
  // so the server-rendered markup and the first client render agree.
  useEffect(() => {
    setForm(current =>
      current.redirectUri ? current : { ...current, redirectUri: defaultRedirectUri(window.location.origin) }
    );
  }, []);

  const save = async () => {
    // Take the secret out of state before anything else: the request gets this local copy only.
    const submitted = form;
    setForm({ ...form, clientSecret: '' });
    setBusy(true);
    setActionError(null);
    const result = await saveOuraApp(submitted);
    setBusy(false);
    if (!result.ok) {
      setActionError(`${result.message} Enter the secret again to retry.`);
      return;
    }
    setWarnings(result.warnings);
    setEditing(false);
    setForm({ ...EMPTY, redirectUri: defaultRedirectUri(window.location.origin) });
    await load();
    onChanged?.();
  };

  const remove = async (url: string, failure: string, after: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(url, { method: 'DELETE', cache: 'no-store' });
      if (res.status !== 204) throw new Error(`${failure} (HTTP ${res.status}).`);
      after();
      await load();
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `${failure}.`);
    } finally {
      setBusy(false);
    }
  };

  const openChange = () => {
    setForm({
      clientId: app?.clientId ?? '',
      clientSecret: '',
      redirectUri: app?.redirectUri ?? defaultRedirectUri(window.location.origin),
    });
    setActionError(null);
    setWarnings([]);
    setEditing(true);
  };
  const closeChange = () => {
    setEditing(false);
    setForm({ ...EMPTY, redirectUri: defaultRedirectUri(window.location.origin) });
    setActionError(null);
  };

  return (
    <>
      {heading ? heading('Oura Ring') : <h2 className="text-base font-semibold text-text-primary mb-5">Oura Ring</h2>}
      <OuraConnectionView
        status={status}
        app={app}
        loadError={loadError}
        notice={noticeFrom(noticeParam)}
        warnings={warnings}
        editing={editing}
        form={form}
        confirming={confirming}
        confirmingRemove={confirmingRemove}
        busy={busy}
        actionError={actionError}
        onFormChange={setForm}
        onSave={() => void save()}
        onAskChange={openChange}
        onCancelChange={closeChange}
        onAskDisconnect={() => setConfirming(true)}
        onCancelDisconnect={() => setConfirming(false)}
        onDisconnect={() => void remove(OURA_PATH, 'Oura could not be disconnected', () => setConfirming(false))}
        onAskRemove={() => setConfirmingRemove(true)}
        onCancelRemove={() => setConfirmingRemove(false)}
        onRemove={() =>
          void remove(OURA_APP_PATH, 'The credentials could not be removed', () => setConfirmingRemove(false))
        }
        onRetry={() => void load()}
      />
    </>
  );
}
