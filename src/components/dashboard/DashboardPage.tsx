'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { addedMessage, movedMessage, removedMessage } from '@/lib/dashboard/announce';
import { moveCard } from '@/lib/dashboard/order';
import type { CardRecord } from '@/lib/dashboard/types';
import { Button } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { getCardUi } from './card-types';
import { describeCard } from './describe-card';
import { moveActions } from './move-actions';
import { Announcer } from './Announcer';
import { CardDialog } from './CardDialog';
import { DashboardView } from './DashboardView';
import { focusAfterRemove, type FocusTarget, type WriteResult } from './dashboard-state';
import type { CardAction } from './CardShell';
import { useDashboard } from './useDashboard';

type DialogState = { mode: 'add' } | { mode: 'edit'; card: CardRecord } | null;

export function DashboardPage() {
  const { units } = useUnits();
  const { state, add, edit, remove, reorder, reload } = useDashboard();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focus, setFocus] = useState<FocusTarget | null>(null);

  // Runs after the render that holds the new or the remaining cards.
  useEffect(() => {
    if (!focus) return;
    const target =
      focus.kind === 'card'
        ? document.querySelector<HTMLElement>(`[data-card-options="${CSS.escape(focus.id)}"]`)
        : null;
    (target ?? document.querySelector<HTMLElement>('[data-dashboard-add]'))?.focus();
    setFocus(null);
  }, [focus]);

  const onAdd = async (input: Parameters<typeof add>[0]): Promise<WriteResult> => {
    const total = state.cards.length + 1;
    const result = await add(input);
    if (result.ok) {
      setAnnouncement(addedMessage(describeCard(result.card), total, total));
      setFocus({ kind: 'card', id: result.card.id });
    }
    return result;
  };

  const onEdit = async (card: CardRecord, input: Parameters<typeof edit>[1]): Promise<WriteResult> => {
    const result = await edit(card, input);
    if (result.ok) setFocus({ kind: 'card', id: card.id });
    return result;
  };

  const onRemove = (card: CardRecord) => {
    setAnnouncement(removedMessage(describeCard(card)));
    setFocus(
      focusAfterRemove(
        state.cards.map(c => c.id),
        card.id
      )
    );
    void remove(card);
  };

  // The menu commands: the same write as a drag, plus what a drag announces for itself.
  const onMove = (card: CardRecord, to: number) => {
    const ids = state.cards.map(c => c.id);
    const next = moveCard(ids, ids.indexOf(card.id), to);
    setAnnouncement(movedMessage(describeCard(card), to + 1, ids.length));
    setFocus({ kind: 'card', id: card.id });
    void reorder(next);
  };

  const closeDialog = () => {
    // The Edit item lives in a menu that has closed, so focus goes to the card's own button.
    if (dialog?.mode === 'edit') setFocus({ kind: 'card', id: dialog.card.id });
    setDialog(null);
  };

  const actionsFor = (card: CardRecord): CardAction[] => {
    const items: CardAction[] = [];
    if (card.status === 'ok' && card.spec !== null && getCardUi(card.type)) {
      items.push({ id: 'edit', label: 'Edit', onSelect: () => setDialog({ mode: 'edit', card }) });
      items.push(
        ...moveActions(
          state.cards.map(c => c.id),
          card.id,
          to => onMove(card, to)
        )
      );
    }
    items.push({ id: 'remove', label: 'Remove', danger: true, onSelect: () => onRemove(card) });
    return items;
  };

  const addAction = (
    <Button variant="primary" data-dashboard-add="" onClick={() => setDialog({ mode: 'add' })}>
      <Plus size={16} className="mr-1.5" aria-hidden="true" />
      Add card
    </Button>
  );

  return (
    <>
      <DashboardView
        state={state}
        context={{ referenceKey: REFERENCE_KEY, system: units }}
        onRetry={reload}
        addAction={state.status === 'ready' ? addAction : undefined}
        actionsFor={actionsFor}
        onReorder={ids => void reorder(ids)}
      />
      <Announcer message={announcement} />
      <CardDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'add'}
        card={dialog?.mode === 'edit' ? dialog.card : undefined}
        onClose={closeDialog}
        onAdd={onAdd}
        onEdit={onEdit}
      />
    </>
  );
}
