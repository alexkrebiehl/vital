'use client';

// ── RangeControl: the one date-range picker every page uses ──────────────────
//
// 7D / 30D / 90D presets, any page-specific extras (for example 1Y or All on the
// metric and lab pages), and a Custom range typed in whole days. It replaces the
// five hand-rolled option lists the pages each carried.
//
// The value is a string the page already holds. `format="days"` ("30") is the
// default; `format="token"` ("30d") is for the metric page, whose URL carries the
// range. A typed range is validated by `parseCustomDays` and only ever handed to
// `onChange` when it is a whole number of days within bounds, so a page never has
// to defend against "0", "-3" or "abc".

import { useEffect, useId, useState } from 'react';
import {
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  RANGE_PRESET_DAYS,
  isCustomRange,
  parseCustomDays,
  presetLabel,
  rangeDays,
  rangeValue,
  type RangeFormat,
} from '@/lib/ranges';

interface ExtraOption {
  value: string;
  label: string;
}

interface RangeControlProps {
  value: string;
  onChange: (value: string) => void;
  /** `days` ("30") or `token` ("30d"). */
  format?: RangeFormat;
  /** Extra options after the presets, e.g. 1Y or All. */
  extraOptions?: ExtraOption[];
  ariaLabel?: string;
  className?: string;
}

const TAB_BASE = 'px-3 py-1.5 text-xs font-medium rounded-[10px] transition-colors min-h-[32px]';
const TAB_ON = 'bg-surface text-text-primary shadow-sm';
const TAB_OFF = 'text-text-secondary hover:text-text-primary';

export function RangeControl({
  value,
  onChange,
  format = 'days',
  extraOptions = [],
  ariaLabel = 'Date range',
  className = '',
}: RangeControlProps) {
  const inputId = useId();
  const presets = RANGE_PRESET_DAYS.map(d => ({ value: rangeValue(d, format), label: presetLabel(d) }));
  const named = [...presets, ...extraOptions];
  const isNamed = named.some(o => o.value === value);

  // "Custom" is active when the value is a valid day count that no button names,
  // or while the person is typing one.
  const valueIsCustom = !isNamed && isCustomRange(value, format);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Opening the box shows the current custom value; leaving custom closes it.
  useEffect(() => {
    if (isNamed) {
      setEditing(false);
      setError(null);
    }
  }, [isNamed]);

  const customActive = editing || valueIsCustom;

  function openCustom() {
    const current = valueIsCustom ? rangeDays(value, format) : null;
    setDraft(current === null ? '' : String(current));
    setError(null);
    setEditing(true);
  }

  function apply() {
    const result = parseCustomDays(draft);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setEditing(false);
    onChange(rangeValue(result.days, format));
  }

  return (
    <div className={`inline-flex flex-col gap-1.5 ${className}`}>
      <div
        className="inline-flex bg-surface-muted rounded-control p-0.5 gap-0.5 flex-wrap"
        role="tablist"
        aria-label={ariaLabel}
      >
        {named.map(opt => (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={value === opt.value && !editing}
            onClick={() => {
              setEditing(false);
              setError(null);
              onChange(opt.value);
            }}
            className={`${TAB_BASE} ${value === opt.value && !editing ? TAB_ON : TAB_OFF}`}
          >
            {opt.label}
          </button>
        ))}
        <button
          role="tab"
          type="button"
          aria-selected={customActive}
          aria-expanded={customActive}
          onClick={openCustom}
          className={`${TAB_BASE} ${customActive ? TAB_ON : TAB_OFF}`}
        >
          {valueIsCustom && !editing ? `Custom · ${rangeDays(value, format)}D` : 'Custom'}
        </button>
      </div>

      {customActive && (
        <form
          noValidate
          className="inline-flex flex-wrap items-center gap-2"
          onSubmit={event => {
            event.preventDefault();
            apply();
          }}
        >
          <label htmlFor={inputId} className="text-xs text-text-secondary">
            Last
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={MIN_CUSTOM_DAYS}
            max={MAX_CUSTOM_DAYS}
            step={1}
            value={draft}
            autoFocus={editing}
            onChange={event => {
              setDraft(event.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? `${inputId}-error` : undefined}
            placeholder="45"
            className="w-20 bg-surface border border-border rounded-control px-2.5 py-1.5 text-sm text-text-primary tnum outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="text-xs text-text-secondary">days</span>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-medium rounded-control bg-primary text-primary-text hover:opacity-90"
          >
            Apply
          </button>
          {error && (
            <span id={`${inputId}-error`} role="alert" className="basis-full text-[11px] text-category-attention">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
