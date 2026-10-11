'use client';

// ── Add or edit a card ──────────────────────────────────────────────────────
//
// docs/design/dashboard.md §8.6, on the shared `Dialog` (focus trap, Escape and
// focus restore come from it). A type chooser only when there is more than one
// type; the type's own Editor; a preview made by the type's real `resolve` and
// `Card`; then the buttons. Submit stays disabled until the spec validates.

import { useState } from 'react';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { getCardSchema, listCardSchemas } from '@/lib/dashboard/card-schemas';
import type { CardEditInput, CardInput } from '@/lib/dashboard/client';
import type { CardRecord } from '@/lib/dashboard/types';
import { Button, Dialog } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { getCardUi } from './card-types';
import { CardShell } from './CardShell';
import type { WriteResult } from './dashboard-state';

export const STALE_COPY = 'This card was changed elsewhere; its current settings are loaded.';

export interface CardDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  /** The card being edited. */
  card?: CardRecord;
  onClose: () => void;
  onAdd: (input: CardInput) => Promise<WriteResult>;
  onEdit: (card: CardRecord, input: CardEditInput) => Promise<WriteResult>;
}

export function CardDialog(props: CardDialogProps) {
  const title = props.mode === 'add' ? 'Add card' : 'Edit card';
  return (
    <Dialog open={props.open} onClose={props.onClose} title={title}>
      <DialogBody {...props} />
    </Dialog>
  );
}

function Preview({ type, spec }: { type: string; spec: unknown }) {
  const { units } = useUnits();
  const ui = getCardUi(type);
  const schema = getCardSchema(type);
  if (!ui || !schema || spec === null) {
    return <p className="text-xs text-text-secondary">Choose a metric and a date to see a preview.</p>;
  }
  const data = ui.resolve(spec, { referenceKey: REFERENCE_KEY, system: units });
  return (
    <CardShell {...ui.heading(spec, data)} actions={[]}>
      <ui.Card spec={spec} data={data} size={schema.defaultSize} />
    </CardShell>
  );
}

function DialogBody({ mode, card, onClose, onAdd, onEdit }: CardDialogProps) {
  const schemas = listCardSchemas();
  const [type, setType] = useState(card?.type ?? schemas[0]?.type ?? '');
  const [current, setCurrent] = useState<CardRecord | undefined>(card);
  const [spec, setSpec] = useState<unknown>(card?.spec ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const schema = getCardSchema(type);
  const ui = getCardUi(type);
  const valid = spec !== null && schema?.validate(spec).ok === true;
  const Editor = ui?.Editor;

  const submit = async () => {
    if (!valid || !schema || busy) return;
    setBusy(true);
    setError(null);
    let result: WriteResult;
    try {
      result =
        mode === 'edit' && current
          ? await onEdit(current, { spec })
          : await onAdd({ type, spec, size: schema.defaultSize });
    } catch (e) {
      result = { ok: false, message: e instanceof Error ? e.message : 'The card was not saved.', keepOpen: true };
    }
    setBusy(false);
    if (result.ok || !result.keepOpen) {
      onClose();
    } else if (result.current) {
      setCurrent(result.current);
      setSpec(result.current.spec);
      setError(STALE_COPY);
    } else {
      setError(result.message);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      {mode === 'add' && schemas.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text-primary">Card type</legend>
          <div className="flex flex-wrap gap-3">
            {schemas.map(s => (
              <label key={s.type} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="card-type"
                  value={s.type}
                  checked={type === s.type}
                  onChange={() => {
                    setType(s.type);
                    setSpec(null);
                  }}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {Editor && <Editor key={`${type}-${current?.revision ?? 0}`} value={spec} onChange={setSpec} />}

      <section aria-labelledby="card-dialog-preview">
        <h3 id="card-dialog-preview" className="mb-2 text-sm font-semibold text-text-primary">
          Preview
        </h3>
        <Preview type={type} spec={valid ? spec : null} />
      </section>

      {error && (
        <p role="alert" className="text-sm text-category-attention">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          {mode === 'add' ? 'Add card' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
