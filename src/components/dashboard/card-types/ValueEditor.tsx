'use client';

// ── The value card's editor: a metric and a date ────────────────────────────
//
// Composes the two pickers into a `ValueCardSpec`, or `null` while the choice is
// incomplete or does not validate (the dialog keeps its submit disabled).

import { useState } from 'react';
import { REFERENCE_KEY, metricHasData } from '@/lib/adapters/dataset';
import { valueSchema } from '@/lib/dashboard/value-schema';
import type { DateSpec, ValueCardSpec } from '@/lib/dashboard/types';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { DateSpecPicker } from '../DateSpecPicker';
import { MetricPicker } from '../MetricPicker';

export interface ValueEditorProps {
  value: ValueCardSpec | null;
  onChange: (spec: ValueCardSpec | null) => void;
}

export function ValueEditor({ value, onChange }: ValueEditorProps) {
  const { activeSources } = useDatasetMeta();
  const [metricId, setMetricId] = useState<string | null>(value?.metricId ?? null);
  const [date, setDate] = useState<DateSpec>(value?.date ?? { kind: 'today' });

  const emit = (nextMetric: string | null, nextDate: DateSpec) => {
    const result = valueSchema.validate({ metricId: nextMetric, date: nextDate });
    onChange(result.ok ? result.spec : null);
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="value-editor-metric">
        <h3 id="value-editor-metric" className="mb-2 text-sm font-semibold text-text-primary">
          Metric
        </h3>
        <MetricPicker
          value={metricId}
          activeSources={activeSources}
          hasData={metricHasData}
          onChange={id => {
            setMetricId(id);
            emit(id, date);
          }}
        />
      </section>
      <section aria-labelledby="value-editor-date">
        <h3 id="value-editor-date" className="mb-2 text-sm font-semibold text-text-primary">
          Date
        </h3>
        <DateSpecPicker
          value={date}
          referenceKey={REFERENCE_KEY}
          onChange={next => {
            setDate(next);
            emit(metricId, next);
          }}
        />
      </section>
    </div>
  );
}
