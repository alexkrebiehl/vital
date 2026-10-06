// ── Body → Overview: the energy balance as a sum ────────
//
// Calories in − calories out = balance, as three tiles. An implied intake (no
// food log) is drawn dashed and marked "≈", so it never reads as measured.

import { KCAL_PER_KG } from '@/lib/body-goal/constants';
import type { EnergyEquation as Equation } from '@/lib/body-goal/energy';
import type { UnitSystem } from '@/lib/prefs';
import { formatKcal, formatKg, formatSignedKcal } from './format';

/** The balance in words, with the weekly weight change it amounts to. */
function balanceNote(kcal: number, units: UnitSystem): string {
  const k = Math.round(kcal);
  if (k === 0) return 'even, holding steady';
  const perWeek = formatKg(Math.abs((kcal * 7) / KCAL_PER_KG), units);
  return k < 0 ? `a deficit, losing approx. ${perWeek}/week` : `a surplus, gaining approx. ${perWeek}/week`;
}

export function EnergyEquation({ eq, loggedDays, units }: { eq: Equation; loggedDays: number; units: UnitSystem }) {
  const implied = eq.in.source === 'implied';

  const tiles = [
    {
      label: 'Calories in',
      hue: 'var(--color-category-nutrition)',
      value: `${implied ? '≈ ' : ''}${formatKcal(eq.in.kcal)}`,
      source: implied ? 'implied: out + balance' : `average of ${loggedDays} complete logged day${loggedDays === 1 ? '' : 's'}`,
    },
    {
      label: 'Calories out',
      hue: 'var(--color-category-activity)',
      value: formatKcal(eq.out.kcal),
      source: eq.out.source === 'weight-trend' ? 'maintenance, from your weight trend' : 'maintenance, device estimate',
    },
    {
      label: 'Daily balance',
      hue: 'var(--color-accent)',
      value: formatSignedKcal(eq.balance.kcal),
      source: balanceNote(eq.balance.kcal, units),
    },
  ];

  const ops = [null, '−', '='];

  return (
    <>
      {/* Narrow screens: the sum written out as on paper, one line per term and a rule above the total. */}
      <div className="sm:hidden rounded-xl bg-surface-muted px-4 py-1">
        {tiles.map((t, i) => (
          <div
            key={t.label}
            className={`grid grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-2 py-2 ${i === 2 ? 'border-t border-border-strong' : ''}`}
          >
            <span className="text-base font-light text-text-secondary" aria-hidden="true">{ops[i]}</span>
            <span className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.hue }} aria-hidden="true" />
              {t.label}
            </span>
            <span className={`tnum text-right ${i === 0 && implied ? 'text-text-secondary' : 'text-text-primary'} ${i === 2 ? 'text-lg font-semibold' : 'text-sm font-medium'}`}>
              {t.value}
            </span>
            <span className="col-start-2 col-span-2 text-[11px] text-text-secondary">{t.source}</span>
          </div>
        ))}
      </div>

      <div className="hidden sm:grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3">
        {tiles.map((t, i) => (
          <Tile key={t.label} {...t} dashed={i === 0 && implied} op={ops[i]} />
        ))}
      </div>
    </>
  );
}

function Tile({ label, hue, value, source, dashed, op }: { label: string; hue: string; value: string; source: string; dashed: boolean; op: string | null }) {
  return (
    <>
      {op && (
        <span className="text-center text-xl font-light text-text-secondary leading-none" aria-hidden="true">
          {op}
        </span>
      )}
      <div className={`rounded-xl bg-surface-muted px-4 py-3 ${dashed ? 'border border-dashed border-border-strong' : ''}`}>
        <p className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hue }} aria-hidden="true" />
          {label}
        </p>
        <p className="mt-0.5 text-lg font-semibold tnum tracking-tight text-text-primary">{value}</p>
        <p className="text-[11px] text-text-secondary">{source}</p>
      </div>
    </>
  );
}
