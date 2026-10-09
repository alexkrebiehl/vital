'use client';

// ── Metric choice for a card ────────────────────────────────────────────────
//
// docs/design/dashboard.md §8.6. A search box above one radio group per
// category. The behaviour is Trends' picker (names and aliases, only metrics a
// connected source can provide, "no data" marked); no data-source name is shown.

import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { pickerGroups } from '@/lib/dashboard/picker';

export interface MetricPickerProps {
  value: string | null;
  onChange: (metricId: string) => void;
  activeSources: readonly string[] | undefined;
  hasData: (metricId: string) => boolean;
  /** Only for the first render (tests); the box is the user's after that. */
  initialQuery?: string;
}

export function MetricPicker({ value, onChange, activeSources, hasData, initialQuery = '' }: MetricPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const name = useId();
  const groups = useMemo(() => pickerGroups(query, activeSources, hasData), [query, activeSources, hasData]);

  return (
    <div>
      <label className="relative block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">Search metrics by name or alias</span>
        <Search size={14} className="absolute left-3 top-[calc(50%+10px)] -translate-y-1/2 text-text-secondary" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="e.g. HRV or sleep"
          className="min-h-[44px] w-full rounded-control border border-border bg-surface-muted py-2 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-accent"
        />
      </label>

      <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
        {groups.map(group => (
          <fieldset key={group.category}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {group.label}
            </legend>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              {group.metrics.map(m => (
                <label
                  key={m.id}
                  className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-sm text-text-primary hover:bg-surface-muted"
                >
                  <input
                    type="radio"
                    name={name}
                    value={m.id}
                    checked={value === m.id}
                    onChange={() => onChange(m.id)}
                  />
                  <span>
                    {m.displayName}
                    {!m.hasData && <span className="ml-1 text-xs text-text-secondary">(no data)</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {groups.length === 0 && (
          <p className="text-xs text-text-secondary">No metric matches &ldquo;{query.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}
