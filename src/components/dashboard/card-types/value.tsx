import Link from 'next/link';
import { dateSpecLabel } from '@/lib/dashboard/date-spec';
import { resolveValueCard, type ValueCardData } from '@/lib/dashboard/value-resolve';
import type { CardSize, ValueCardSpec } from '@/lib/dashboard/types';
import { getMetric } from '@/lib/metrics';
import { Spark } from '@/components/art/Spark';
import { BloodPressureSpark } from '@/components/art/BloodPressureSpark';
import { CATEGORY_VAR } from '@/components/art/categories';
import { artCategoryOf } from '@/components/domain/DomainShared';
import { DataStateNote } from '@/components/ui/primitives';
import type { CardTypeUi } from './types';

/** Every string is already formatted by the resolver; this renders, it never computes a number. */
export function ValueCard({ spec, data }: { spec: ValueCardSpec; data: ValueCardData; size: CardSize }) {
  const name = getMetric(spec.metricId)?.displayName;
  const color = CATEGORY_VAR[artCategoryOf(spec.metricId)];

  let body;
  if (data.state === 'value') {
    body = (
      <>
        <p className="tnum text-[32px] font-semibold leading-none tracking-[-0.035em] text-text-primary md:text-[36px]">
          {data.headline}
        </p>
        {data.qualifier && <p className="mt-2 text-xs text-text-secondary">{data.qualifier}</p>}
        {data.detail && <p className="mt-1 text-xs text-text-secondary">{data.detail}</p>}
        {data.note && (
          <div className="mt-2">
            <DataStateNote>{data.note}</DataStateNote>
          </div>
        )}
        {data.spark?.kind === 'line' && (
          <div className="mt-3">
            <Spark values={data.spark.values} color={color} height={40} />
          </div>
        )}
        {data.spark?.kind === 'pair' && (
          <div className="mt-3">
            <BloodPressureSpark readings={data.spark.readings} height={40} />
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-base font-semibold text-text-primary">
          {data.state === 'no-reading' ? 'No reading' : 'Not available'}
        </p>
        <p className="mt-1 text-xs text-text-secondary">{data.reason}</p>
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">{body}</div>
      {name && (
        <Link
          href={`/metric/${encodeURIComponent(spec.metricId)}`}
          className="mt-4 inline-flex text-[13px] font-medium text-primary hover:underline"
        >
          Open detail<span className="sr-only"> for {name}</span>
        </Link>
      )}
    </div>
  );
}

function describeDate(spec: ValueCardSpec): string {
  const { date } = spec;
  if (date.kind === 'today') return 'today';
  if (date.kind === 'yesterday') return 'yesterday';
  return dateSpecLabel(date, '');
}

export const valueCardUi: CardTypeUi<ValueCardSpec, ValueCardData> = {
  type: 'value',
  resolve: resolveValueCard,
  Card: ValueCard,
  describe: spec => `${getMetric(spec.metricId)?.displayName ?? spec.metricId}, ${describeDate(spec)}`,
  heading: (spec, data) => {
    const meta = getMetric(spec.metricId);
    if (!meta) return { title: spec.metricId };
    return {
      title: meta.displayName,
      metricId: meta.id,
      ...(data.state === 'unknown-metric' ? {} : { dateLabel: data.dateLabel }),
    };
  },
};
