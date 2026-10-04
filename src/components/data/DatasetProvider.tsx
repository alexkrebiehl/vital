'use client';

// ── Dataset provider ────────────────────────────────────
//
// Installs the dataset the pages read, then renders them.
//
// The data layer (`@/lib/adapters/dataset`) keeps the active dataset in module
// scope so that every existing page and component keeps working unchanged — the
// product's internal shape was not redesigned for the live source. This provider
// is the one place that swaps it:
//
//   * live mode  — the server fetched, normalized and cached the Health Auto
//                  Export history and passed it here as a prop. The browser never
//                  talks to the health API and never sees the token.
//   * demo mode  — nothing is passed: the client bundle already contains the
//                  committed fixtures, so the demo path stays exactly as it was.
//
// The install happens during render, before children render. It is idempotent.
//
// The pages are rendered IN THE BROWSER ONLY (`DatasetReady`). One server
// process answers for several profiles, and the server-side render of a client
// component cannot be tied to a request scope: installing the dataset there
// would put one person's history where another's concurrent render could read
// it. So the server renders the shell and a loading state, never touches the
// dataset module, and the browser installs this request's dataset (already in
// the props) and renders the page on mount.

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { HealthFixtures } from '@/lib/metrics/types';
import {
  datasetMeta,
  resetToDemoDataset,
  setActiveDataset,
  type DataMode,
} from '@/lib/adapters/dataset';
import type { ClientDatasetMeta } from '@/lib/adapters/meta';
import { FALLBACK_CLIENT_META } from './fallback-meta';
import { LoadingState } from '@/components/ui/primitives';

const FALLBACK_META = FALLBACK_CLIENT_META;

const DatasetMetaContext = createContext<ClientDatasetMeta>(FALLBACK_META);

export interface DatasetProviderProps {
  mode: DataMode;
  /** Present only in live mode. */
  dataset: HealthFixtures | null;
  meta: ClientDatasetMeta | null;
  children: ReactNode;
}

export function DatasetProvider({ mode, dataset, meta, children }: DatasetProviderProps) {
  const value = useMemo<ClientDatasetMeta>(() => {
    if (meta) return meta;
    const server = datasetMeta();
    return { ...FALLBACK_META, mode: server.mode, live: server.live, referenceKey: server.referenceKey };
  }, [meta]);

  if (typeof window !== 'undefined') {
    if (mode === 'live' && dataset) {
      setActiveDataset(dataset, {
        mode: 'live',
        dataAsOf: meta?.dataAsOf ?? dataset.windowEnd,
        generatedAt: meta?.generatedAt,
      });
    } else {
      resetToDemoDataset();
    }
  }

  return <DatasetMetaContext.Provider value={value}>{children}</DatasetMetaContext.Provider>;
}

const noSubscription = () => () => {};

/**
 * Renders its children only in the browser, after hydration: on the server (and
 * in the first client render, so hydration matches) it is a loading state.
 * Wraps every page, because pages read the dataset while they render.
 */
export function DatasetReady({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  return mounted ? <>{children}</> : <LoadingState label="Loading your data" />;
}

/** What the active dataset is, how fresh it is, and where it came from. */
export function useDatasetMeta(): ClientDatasetMeta {
  return useContext(DatasetMetaContext);
}
