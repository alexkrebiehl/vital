// ── The Oura app credentials form, as pure presentation ─────────────────────
//
// The secret field is a password input that is never given a value from the
// server: the stored secret is shown only as its last 4 characters, elsewhere.

import { Button } from '@/components/ui/primitives';
import { canSaveOuraApp, type OuraAppView, type OuraFormValues } from './oura-card';

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-surface border border-border-strong rounded-control text-text-primary ' +
  'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

export interface OuraAppFormProps {
  app: OuraAppView;
  /** The Change form is open on stored credentials. */
  editing: boolean;
  form: OuraFormValues;
  busy: boolean;
  actionError: string | null;
  onFormChange: (next: OuraFormValues) => void;
  onSave: () => void;
  onCancelChange: () => void;
}

export function OuraAppForm(props: OuraAppFormProps) {
  const { app, editing, form, busy } = props;
  const disabled = !app.available || busy;
  const keepsSecret = editing && app.configured && !app.needsReentry;
  const set = (field: keyof OuraFormValues) => (event: { target: { value: string } }) =>
    props.onFormChange({ ...form, [field]: event.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={event => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Client ID</span>
        <input
          type="text"
          className={INPUT_CLASS}
          value={form.clientId}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={set('clientId')}
        />
      </label>
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Client secret</span>
        <input
          type="password"
          className={INPUT_CLASS}
          value={form.clientSecret}
          placeholder={keepsSecret ? 'Leave blank to keep the stored secret' : 'Paste the client secret'}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          onChange={set('clientSecret')}
        />
      </label>
      <label className="block text-xs text-text-secondary space-y-1">
        <span>Redirect URI</span>
        <input
          type="url"
          className={INPUT_CLASS}
          value={form.redirectUri}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={set('redirectUri')}
        />
      </label>
      <p className="text-xs text-text-secondary leading-relaxed">
        The redirect URI must match, exactly, the redirect URI registered for your app in Oura&apos;s developer portal.
        Oura accepts plain http only for localhost; use https for any other address.
      </p>
      {props.actionError && (
        <p className="text-xs text-category-attention" role="alert">
          {props.actionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !canSaveOuraApp(app, editing, form)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" size="sm" onClick={props.onCancelChange} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
