// ── Date ranges: one vocabulary for every page that has a date selection ──────
//
// Every range picker offers the same three presets (7, 30 and 90 days) and a
// custom range typed in days. Pages used to define their own option lists
// (30/90/180/365 on one, 30/90 on another, 7/30/90/1y/all on a third), so the
// same control behaved differently from page to page.
//
// A range VALUE is a string. Most pages hold plain days ("30"); the metric detail
// page's URL tokens carry a "d" suffix ("30d"). `RangeFormat` says which, and
// every function here is pure so the rules can be tested without rendering.

/** The presets every range control offers, in order. */
export const RANGE_PRESET_DAYS = [7, 30, 90] as const;

/** Custom ranges are whole days from 1 up to this many (ten years). */
export const MIN_CUSTOM_DAYS = 1;
export const MAX_CUSTOM_DAYS = 3650;

/** `days` -> "30"; `token` -> "30d". */
export type RangeFormat = 'days' | 'token';

/** Written form of a number of days under a format. */
export function rangeValue(days: number, format: RangeFormat = 'days'): string {
  return format === 'token' ? `${days}d` : String(days);
}

/**
 * The number of days a range value stands for, or `null` when it is not a
 * positive whole number of days (including "all", which is not a day count).
 */
export function rangeDays(value: string, format: RangeFormat = 'days'): number | null {
  const match = (format === 'token' ? /^(\d{1,5})d$/ : /^(\d{1,5})$/).exec(value.trim());
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days >= MIN_CUSTOM_DAYS ? days : null;
}

export type CustomRangeResult =
  | { ok: true; days: number }
  | { ok: false; message: string };

/** Validate what was typed into the custom-range box. */
export function parseCustomDays(input: string): CustomRangeResult {
  const text = input.trim();
  const message = `Enter a whole number of days from ${MIN_CUSTOM_DAYS} to ${MAX_CUSTOM_DAYS}.`;
  if (!/^\d+$/.test(text)) return { ok: false, message };
  const days = Number(text);
  if (!Number.isSafeInteger(days) || days < MIN_CUSTOM_DAYS || days > MAX_CUSTOM_DAYS) {
    return { ok: false, message };
  }
  return { ok: true, days };
}

/** True when `value` is one of the preset day counts (so it is not "custom"). */
export function isPresetRange(value: string, format: RangeFormat = 'days'): boolean {
  const days = rangeDays(value, format);
  return days !== null && (RANGE_PRESET_DAYS as readonly number[]).includes(days);
}

/** True when `value` is a valid day count that is NOT one of the presets. */
export function isCustomRange(value: string, format: RangeFormat = 'days'): boolean {
  return rangeDays(value, format) !== null && !isPresetRange(value, format);
}

/** The label a preset button carries: "7D", "30D", "90D". */
export function presetLabel(days: number): string {
  return `${days}D`;
}
