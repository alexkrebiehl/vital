import type { ReactNode } from 'react';
import type { CardRecord } from '@/lib/dashboard/types';
import { DomainHeader } from '@/components/domain/DomainShared';
import { Card, DataStateNote, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { getCardUi } from './card-types';
import type { ResolveContext } from './card-types/types';
import { CardShell, type CardAction } from './CardShell';
import { describeCard } from './describe-card';
import { DashboardGrid, type GridItem } from './DashboardGrid';
import type { DashboardState } from './dashboard-state';

export const NO_DATABASE_COPY = 'The dashboard is stored in the database, and no database is configured.';
const CANNOT_SHOW = 'This card can’t be shown';
const UNKNOWN_TYPE = 'This card’s type is not part of this version of Vital.';

export interface DashboardViewProps {
  state: DashboardState;
  context: ResolveContext;
  onRetry: () => void;
  /** The "Add card" button, supplied by the page that owns the dialog. */
  addAction?: ReactNode;
  actionsFor?: (card: CardRecord) => CardAction[];
  /** The new order of every card id after a drag. Without it the cards cannot be dragged. */
  onReorder?: (ids: string[]) => void;
}

function CardItem({
  card,
  context,
  actions,
  handle,
}: {
  card: CardRecord;
  context: ResolveContext;
  actions: CardAction[];
  handle?: ReactNode;
}) {
  const ui = getCardUi(card.type);
  if (card.status === 'unreadable' || card.spec === null || !ui) {
    return (
      <CardShell
        cardId={card.id}
        title={CANNOT_SHOW}
        actions={actions}
        handle={handle}
        problem={card.problem ?? (ui ? 'This card could not be read.' : UNKNOWN_TYPE)}
      />
    );
  }
  const data = ui.resolve(card.spec, context);
  const heading = ui.heading(card.spec, data);
  return (
    <CardShell cardId={card.id} {...heading} actions={actions} handle={handle}>
      <ui.Card spec={card.spec} data={data} size={card.layout} />
    </CardShell>
  );
}

function SkeletonCard() {
  return (
    <Card className="h-full space-y-3 p-5">
      <Skeleton height={14} width="45%" />
      <Skeleton height={36} width="60%" />
      <Skeleton height={40} />
    </Card>
  );
}

const SKELETONS: GridItem[] = [1, 2, 3].map(n => ({
  id: `skeleton-${n}`,
  size: { w: 1, h: 1 },
  render: () => <SkeletonCard />,
}));

/** The Dashboard page's markup for each state of §8.2: props in, markup out. */
export function DashboardView({ state, context, onRetry, addAction, actionsFor, onReorder }: DashboardViewProps) {
  const header = (action?: ReactNode) => (
    <DomainHeader title="Dashboard" subtitle="Your own cards for any metric." category="overview">
      {action}
    </DomainHeader>
  );

  if (state.status === 'loading') {
    return (
      <div className="space-y-6">
        {header()}
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading the dashboard</span>
          <DashboardGrid items={SKELETONS} label="Loading cards" />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    const noDatabase = state.error?.httpStatus === 503;
    const reason = state.error?.message ?? '';
    return (
      <div className="space-y-6">
        {header()}
        {noDatabase ? (
          <ErrorState title="Dashboard unavailable" message={[NO_DATABASE_COPY, reason].filter(Boolean).join(' ')} />
        ) : (
          <ErrorState
            title="The dashboard could not be loaded"
            message={reason || 'Could not load the dashboard.'}
            onRetry={onRetry}
          />
        )}
      </div>
    );
  }

  const notice = state.notice ? <DataStateNote tone="attention">{state.notice}</DataStateNote> : null;
  if (state.cards.length === 0) {
    return (
      <div className="space-y-6">
        {header()}
        {notice}
        <EmptyState
          title="No cards yet"
          description="Add a card for any metric, for today, yesterday or a date range."
          action={addAction}
        />
      </div>
    );
  }

  const items: GridItem[] = state.cards.map(card => ({
    id: card.id,
    size: card.layout,
    describe: describeCard(card),
    render: ({ handle, overlay }) => (
      <CardItem card={card} context={context} actions={overlay ? [] : (actionsFor?.(card) ?? [])} handle={handle} />
    ),
  }));
  return (
    <div className="space-y-6">
      {header(addAction)}
      {notice}
      <DashboardGrid items={items} onReorder={onReorder} />
    </div>
  );
}
