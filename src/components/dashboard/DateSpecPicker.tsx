'use client';

// ── Date choice for a card ──────────────────────────────────────────────────
//
// docs/design/dashboard.md §8.6. Today and Yesterday roll with the reference
// day; a range is two fixed dates, filled by hand or by a 7 / 30 / 90-day quick
// pick. The label under the control is the one the card will show.

import { useId } from 'react';
import { quickPickRange, dateSpecLabel, validateDateSpec } from '@/lib/dashboard/date-spec';
import type { DateSpec } from '@/lib/dashboard/types';
import { RANGE_PRESET_DAYS } from '@/lib/ranges';
import { Button, SegmentedControl } from '@/components/ui/primitives';

export interface DateSpecPickerProps {
  /** A range may hold half-typed dates; `validateDateSpec` says what is wrong. */
  value: DateSpec;
  onChange: (spec: DateSpec) => void;
  referenceKey: string;
}

const OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'range', label: 'Date range' },
];

const INPUT =
  'min-h-[44px] w-full rounded-control border border-border bg-surface-muted px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent';

export function DateSpecPicker({ value, onChange, referenceKey }: DateSpecPickerProps) {
  const errorId = useId();
  const startId = useId();
  const endId = useId();

  const choose = (kind: string) => {
    if (kind === 'today') onChange({ kind: 'today' });
    else if (kind === 'yesterday') onChange({ kind: 'yesterday' });
    else if (value.kind !== 'range') onChange(quickPickRange(RANGE_PRESET_DAYS[0], referenceKey));
  };

  const check = value.kind === 'range' ? validateDateSpec(value) : null;
  const errors = check && !check.ok ? check.errors : [];
  const describedBy = errors.length > 0 ? errorId : undefined;

  return (
    <div className="space-y-3">
      <SegmentedControl options={OPTIONS} value={value.kind} onChange={choose} ariaLabel="Date" />
      {value.kind !== 'range' && <p className="text-xs text-text-secondary">{dateSpecLabel(value, referenceKey)}</p>}

      {value.kind === 'range' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            {RANGE_PRESET_DAYS.map(days => {
              const pick = quickPickRange(days, referenceKey);
              const active = pick.start === value.start && pick.end === value.end;
              return (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant={active ? 'primary' : 'secondary'}
                  aria-label={`Last ${days} days`}
                  aria-pressed={active}
                  onClick={() => onChange(pick)}
                >
                  {days}D
                </Button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={startId} className="mb-1 block text-xs font-medium text-text-secondary">
                Start date
              </label>
              <input
                id={startId}
                type="date"
                value={value.start}
                max={referenceKey}
                aria-invalid={errors.length > 0 || undefined}
                aria-describedby={describedBy}
                onChange={e => onChange({ ...value, start: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor={endId} className="mb-1 block text-xs font-medium text-text-secondary">
                End date
              </label>
              <input
                id={endId}
                type="date"
                value={value.end}
                max={referenceKey}
                aria-invalid={errors.length > 0 || undefined}
                aria-describedby={describedBy}
                onChange={e => onChange({ ...value, end: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          {errors.length > 0 ? (
            <div id={errorId} role="alert" className="space-y-1 text-xs text-category-attention">
              {errors.map(e => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary">This card will keep showing {dateSpecLabel(value, referenceKey)}.</p>
          )}
        </div>
      )}
    </div>
  );
}
