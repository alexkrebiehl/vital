'use client';

import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { useUnits } from '@/components/ui/UnitsProvider';
import { DashboardView } from './DashboardView';
import { useDashboard } from './useDashboard';

export function DashboardPage() {
  const { units } = useUnits();
  const { state, reload } = useDashboard();
  return <DashboardView state={state} context={{ referenceKey: REFERENCE_KEY, system: units }} onRetry={reload} />;
}
