import type { ReactNode } from 'react';
import { gridSpanClasses } from '@/lib/dashboard/grid';
import type { CardSize } from '@/lib/dashboard/types';

export interface GridItem {
  id: string;
  size: CardSize;
  node: ReactNode;
}

/**
 * A static CSS grid, 1 / 2 / 3 / 4 columns, in DOM order. No `grid-auto-flow:
 * dense`: what you see in order is what a keyboard and a screen reader get.
 * Drag-and-drop arrives inside this file and nowhere else.
 */
export function DashboardGrid({ items, label = 'Dashboard cards' }: { items: GridItem[]; label?: string }) {
  return (
    <ul
      aria-label={label}
      className="grid auto-rows-[minmax(13rem,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {items.map(item => (
        <li key={item.id} className={`min-w-0 ${gridSpanClasses(item.size)}`}>
          {item.node}
        </li>
      ))}
    </ul>
  );
}
