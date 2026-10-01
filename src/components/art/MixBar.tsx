export interface MixSlice { label: string; value: number; display: string; detail?: string }

const HUES = [
  'var(--color-category-activity)',
  'var(--color-category-sleep)',
  'var(--color-category-nutrition)',
  'var(--color-category-attention)',
  'var(--color-category-cardiovascular)',
  'var(--color-category-respiratory)',
];

/**
 * One stacked bar with a legend: how a total divides between categories. Slices
 * are sized by `value` and labelled with the caller's own formatted `display`,
 * so this component never formats or invents a number. Zero-value slices are
 * dropped; with no slices it renders nothing.
 */
export function MixBar({ slices, summary }: { slices: MixSlice[]; summary: string }) {
  const live = slices.filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const total = live.reduce((t, s) => t + s.value, 0);
  if (live.length === 0 || total <= 0) return null;
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[3px] overflow-hidden rounded-full" role="img" aria-label={summary}>
        {live.map((s, i) => (
          <div key={s.label} title={`${s.label}: ${s.display}`}
            style={{ width: `${(s.value / total) * 100}%`, background: HUES[i % HUES.length] }}
            className="first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <ul className="mt-4 grid list-none grid-cols-1 gap-x-8 gap-y-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {live.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: HUES[i % HUES.length] }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{s.label}</span>
            <span className="text-sm font-medium tnum text-text-primary">{s.display}</span>
            {s.detail && <span className="text-xs tnum text-text-secondary">{s.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
