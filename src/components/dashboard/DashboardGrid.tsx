'use client';

// ── The card grid, and the only file that knows about dnd-kit ───────────────
//
// docs/design/dashboard.md §8.3, §8.7, §9. CSS grid, 1 / 2 / 3 / 4 columns, in
// DOM order (no `grid-auto-flow: dense`). With `onReorder` the cards can be
// dragged by their handle, by pointer, touch or keyboard. The order maths and
// the announcement sentences are our own pure modules; this file only wires
// them to the library, so replacing the library is a change to this file.

import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cancelledMessage, droppedMessage, movedMessage, pickedUpMessage } from '@/lib/dashboard/announce';
import { gridSpanClasses } from '@/lib/dashboard/grid';
import { moveCard } from '@/lib/dashboard/order';
import type { CardSize } from '@/lib/dashboard/types';

export interface GridSlot {
  /** The drag handle for this card, or null when the card cannot be dragged. */
  handle: ReactNode;
  /** True for the copy shown under the pointer while dragging: no controls in it. */
  overlay: boolean;
}

export interface GridItem {
  id: string;
  size: CardSize;
  /** The card's accessible name, for example "Steps, today". */
  describe?: string;
  render: (slot: GridSlot) => ReactNode;
}

const GRID_CLASS =
  'grid auto-rows-[minmax(13rem,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const HANDLE_CLASS =
  'inline-flex cursor-grab items-center justify-center rounded-control px-2.5 py-1.5 text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent';
const INSTRUCTIONS =
  'To pick up a card, press space or enter. Use the arrow keys to move it, space or enter to drop it, escape to cancel.';

const nameOf = (item: GridItem | undefined) => item?.describe ?? 'card';

function SortableCell({ item }: { item: GridItem }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={`Move ${nameOf(item)}`}
      className={HANDLE_CLASS}
      style={{ touchAction: 'none' }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} aria-hidden="true" />
    </button>
  );
  return (
    <li ref={setNodeRef} style={style} className={`min-w-0 ${gridSpanClasses(item.size)}`}>
      {item.render({ handle, overlay: false })}
    </li>
  );
}

export function DashboardGrid({
  items,
  label = 'Dashboard cards',
  onReorder,
}: {
  items: GridItem[];
  label?: string;
  /** The new order of every card id. Called once per completed move. Omit for a grid that cannot be arranged. */
  onReorder?: (ids: string[]) => void;
}) {
  const dndId = useId(); // stable between server and browser: the library's own counter is not
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!onReorder) {
    return (
      <ul aria-label={label} className={GRID_CLASS}>
        {items.map(item => (
          <li key={item.id} className={`min-w-0 ${gridSpanClasses(item.size)}`}>
            {item.render({ handle: null, overlay: false })}
          </li>
        ))}
      </ul>
    );
  }

  const ids = items.map(i => i.id);
  const find = (id: UniqueIdentifier) => items.find(i => i.id === id);
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => pickedUpMessage(nameOf(find(active.id)), position(active.id), ids.length),
    onDragOver: ({ active, over }) =>
      over ? movedMessage(nameOf(find(active.id)), position(over.id), ids.length) : undefined,
    onDragEnd: ({ active, over }) =>
      droppedMessage(nameOf(find(active.id)), position(over?.id ?? active.id), ids.length),
    onDragCancel: ({ active }) => cancelledMessage(nameOf(find(active.id)), position(active.id), ids.length),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    onReorder(moveCard(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const active = activeId === null ? undefined : find(activeId);
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={({ active: a }) => setActiveId(a.id)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul aria-label={label} className={GRID_CLASS}>
          {items.map(item => (
            <SortableCell key={item.id} item={item} />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay>
        {active ? (
          <div aria-hidden="true" className="h-full cursor-grabbing shadow-pop">
            {active.render({ handle: null, overlay: true })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
