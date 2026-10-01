'use client';

// ── /medications — what was logged ──────────────────────────────────────────
//
// WHAT THIS PAGE IS. A view of the medication records the owner's Health Auto
// Export history holds for a bounded window: the doses attributable to today, a
// per-medication history over the window, and the window the data actually
// covers. It reports WHAT WAS LOGGED.
//
// WHAT THIS PAGE MAY NOT DO. No adherence score, no percentage, no target, no
// "missed" verdict, no advice, and no diagnostic, treatment or prescribing word
// anywhere in the copy — a dose the source does not state is never rendered as
// 0, a day with no records is never drawn as a zero bar, and a record with no
// scheduled date is listed rather than dropped. The source's own free-text label
// is shown verbatim; no strength is parsed out of it or invented.
//
// THE EMPTY STATE IS HONEST: with no records in the window the page says so in
// words — no empty chart, no zeroes.
//
// The decisions (grouping, per-day series, counts, labels) live in
// `@/lib/medications/view` as pure functions with their own tests; this file is
// the presentation over them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pill } from 'lucide-react';
import { Badge, Card, DataStateNote, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { formatDayKeyLong, addDays } from '@/lib/analytics/windows';
import { fetchMedications, type MedicationReadResponse } from '@/lib/medications/client-data';
import {
  MEDICATIONS_LOOKBACK_DAYS,
  formatUnits,
  groupMedications,
  hasNoRecords,
  medicationsWindow,
  recordsOnDay,
  scheduledTimeLabel,
  statusSummaryWords,
  undatedRecords,
  type MedicationGroup,
} from '@/lib/medications/view';
import type { MedicationRecord, MedicationStatus } from '@/lib/adapters/medications';
import { DomainHeader, SectionTitle } from './DomainShared';

// ── State ───────────────────────────────────────────────────────────────────

interface MedicationsState {
  loading: boolean;
  error: string | null;
  data: MedicationReadResponse | null;
}

export function MedicationsPage() {
  const { referenceKey } = useDatasetMeta();
  const [state, setState] = useState<MedicationsState>({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const data = await fetchMedications(medicationsWindow(referenceKey, MEDICATIONS_LOOKBACK_DAYS));
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : 'The medication records could not be read.',
      });
    }
  }, [referenceKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <div className="space-y-6">
        <DomainHeader
          title="Medications"
          subtitle="The doses you logged, and when."
        />
        <LoadingState label="Reading the recorded medication doses" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="space-y-6">
        <DomainHeader
          title="Medications"
          subtitle="The doses you logged, and when."
        />
        <ErrorState
          title="The medication records could not be read"
          message={`${state.error ?? 'No medication records were returned.'} Nothing is shown in their place — no zeroes, no placeholder rows.`}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return <MedicationsContent data={state.data} referenceKey={referenceKey} onRefresh={load} />;
}

// ── The page ────────────────────────────────────────────────────────────────

function MedicationsContent({
  data,
  referenceKey,
  onRefresh,
}: {
  data: MedicationReadResponse;
  referenceKey: string;
  onRefresh: () => void;
}) {
  const records = data.records;
  const empty = hasNoRecords(records);

  const today = useMemo(() => recordsOnDay(records, referenceKey), [records, referenceKey]);
  const groups = useMemo(() => groupMedications(records), [records]);
  const undated = useMemo(() => undatedRecords(records), [records]);

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Medications"
        subtitle={`The doses you logged over the last ${MEDICATIONS_LOOKBACK_DAYS} days.`}
      >
        <Badge variant="default" className="text-[10px]">
          {records.length} record{records.length === 1 ? '' : 's'}
        </Badge>
        <button type="button" onClick={onRefresh} className="text-xs text-primary hover:underline">
          Refresh
        </button>
      </DomainHeader>

      {/* ── Source not configured, or a genuine read failure ───────── */}
      {!data.available && (
        <Card className="p-5">
          <DataStateNote tone="attention">
            {data.reason ?? 'The medication source could not be read.'} Nothing is shown in its place.
          </DataStateNote>
        </Card>
      )}

      {/* ── Empty state: the honest default ─────────────────────────── */}
      {empty && (
        <Card className="p-6">
          <EmptyState
            icon={<Pill size={26} aria-hidden="true" />}
            title="No medication records in this window"
            description={`There are no medication records in the last ${MEDICATIONS_LOOKBACK_DAYS} days. No dose was logged in this window. Nothing is shown in place of it: no zeroes, no empty chart.`}
          />
        </Card>
      )}

      {/* ── Today's doses ──────────────────────────────────────────── */}
      {!empty && (
        <section>
          <SectionTitle hint={formatDayKeyLong(referenceKey)}>Doses recorded today</SectionTitle>
          <Card className="p-5">
            {today.length === 0 ? (
              <DataStateNote>
                No dose was recorded on {formatDayKeyLong(referenceKey)}. A day with no recorded dose is not a
                day of zero doses — it is a day the source logged nothing.
              </DataStateNote>
            ) : (
              <ul className="list-none p-0 m-0 divide-y divide-border">
                {today.map(record => (
                  <li key={record.id || `${record.displayText}-${record.scheduledDate}`}>
                    <TodayRow record={record} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* ── Per-medication history ─────────────────────────────────── */}
      {!empty && groups.length > 0 && (
        <section>
          <SectionTitle hint={`${groups.length} medication${groups.length === 1 ? '' : 's'}`}>
            Per-medication history
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map(group => (
              <MedicationGroupCard key={group.key} group={group} referenceKey={referenceKey} />
            ))}
          </div>
        </section>
      )}

      {/* ── Records with no scheduled date (undated, listed not dropped) ─ */}
      {undated.length > 0 && (
        <section>
          <SectionTitle hint={`${undated.length} record${undated.length === 1 ? '' : 's'}`}>
            Records with no scheduled date
          </SectionTitle>
          <Card className="p-5 space-y-3">
            <DataStateNote>
              These records carry no scheduled date, so they fall inside no day and are attributed to none. They
              are listed here rather than dropped or counted into a day.
            </DataStateNote>
            <ul className="list-none p-0 m-0 divide-y divide-border">
              {undated.map(record => (
                <li key={record.id || record.displayText} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-text-primary">{record.displayText}</span>
                  <StatusBadge status={record.status} />
                  <span className="text-xs text-text-secondary tnum">{formatUnits(record.dosage)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function TodayRow({ record }: { record: MedicationRecord }) {
  return (
    <div className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-medium text-text-primary">{record.displayText}</span>
      <span className="text-xs text-text-secondary tnum">{scheduledTimeLabel(record.scheduledDate)}</span>
      <StatusBadge status={record.status} />
      <span className="text-xs text-text-secondary tnum ml-auto">{formatUnits(record.dosage)}</span>
    </div>
  );
}

/**
 * A status as a WORD (with tone, never colour alone). 'Unknown' says what it
 * means — the source recorded no status — rather than inventing one.
 */
export function StatusBadge({ status }: { status: MedicationStatus }) {
  if (status === 'Taken') {
    return (
      <Badge variant="success" className="text-[10px]">
        Taken
      </Badge>
    );
  }
  if (status === 'Skipped') {
    return (
      <Badge variant="warning" className="text-[10px]">
        Skipped
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-[10px]">
      Status not recorded
    </Badge>
  );
}

function MedicationGroupCard({ group, referenceKey }: { group: MedicationGroup; referenceKey: string }) {
  const words = statusSummaryWords(group.records);
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{group.key}</span>
        <Badge variant="default" className="shrink-0 text-[10px]">
          {group.records.length} record{group.records.length === 1 ? '' : 's'}
        </Badge>
      </div>

      <DoseStrip records={group.records} referenceKey={referenceKey} days={MEDICATIONS_LOOKBACK_DAYS} />

      <div className="mt-3 space-y-0.5 text-[11px] text-text-secondary">
        <p>
          {group.days.length === 0
            ? 'No dated record in this window'
            : `Recorded on ${group.days.length} day${group.days.length === 1 ? '' : 's'} · last ${formatDayKeyLong(group.lastDay!)}`}
        </p>
        <p>{group.skipped === 0 ? 'No entry was recorded as skipped' : `${group.skipped} recorded as skipped`}</p>
        {words.length > 0 && <p>{words.join(' · ')}</p>}
      </div>
    </Card>
  );
}

/**
 * One cell per day of the window: filled when a dose was logged, amber when any
 * record that day is marked skipped, hollow when nothing was logged. A hollow
 * cell means the source holds no record for that day, not that a dose was
 * missed, and the legend says so. The same information is given in words in the
 * card below and in the accessible label.
 */
function DoseStrip({ records, referenceKey, days }: { records: MedicationRecord[]; referenceKey: string; days: number }) {
  const byDay = new Map<string, { taken: number; skipped: number; other: number }>();
  for (const r of records) {
    if (!r.dayKey) continue;
    const c = byDay.get(r.dayKey) ?? { taken: 0, skipped: 0, other: 0 };
    if (r.status === 'Taken') c.taken += 1; else if (r.status === 'Skipped') c.skipped += 1; else c.other += 1;
    byDay.set(r.dayKey, c);
  }
  const cells = Array.from({ length: days }, (_, i) => addDays(referenceKey, i - (days - 1)));
  const recorded = cells.filter(k => byDay.has(k)).length;
  return (
    <div role="img" aria-label={`Recorded on ${recorded} of the last ${days} days. Hollow cells are days with no record.`}>
      <div className="flex gap-[3px]">
        {cells.map(k => {
          const c = byDay.get(k);
          const style = !c
            ? 'border border-border-strong bg-transparent'
            : c.skipped > 0
              ? 'bg-category-attention'
              : 'bg-primary';
          return (
            <span key={k} title={`${formatDayKeyLong(k)}: ${!c ? 'no record' : c.skipped > 0 ? 'a dose recorded as skipped' : 'recorded'}`}
              className={`h-7 min-w-0 flex-1 rounded-[4px] ${style}`} />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-text-secondary">
        <span>{formatDayKeyLong(cells[0])}</span>
        <span>hollow = no record</span>
        <span>{formatDayKeyLong(cells[cells.length - 1])}</span>
      </div>
    </div>
  );
}
