import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The lifecycle module is replaced so the retry in reconcile can be observed.
const syncLifecycle = vi.fn<(active: string[], env: NodeJS.ProcessEnv) => Promise<unknown>>();
vi.mock('@/lib/sources/lifecycle', () => ({ syncLifecycle: (a: string[], e: NodeJS.ProcessEnv) => syncLifecycle(a, e) }));

import { clearPurgersForTests, reconcileActiveSources, resetPurgeStateForTests } from '@/lib/sources/purge';
import type { SourceContext } from '@/lib/sources/registry';

function ctx(hae: boolean): SourceContext {
  return {
    env: (hae ? { HAE_API_URL: 'http://hae.test', HAE_API_KEY: 'k' } : {}) as unknown as NodeJS.ProcessEnv,
    hasCredential: async () => false,
    labReportCount: async () => 0,
  };
}

describe('reconcile → lifecycle', () => {
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
    syncLifecycle.mockReset();
  });
  afterEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });

  it('records the lifecycle at the first call and when the set changes, not otherwise', async () => {
    syncLifecycle.mockResolvedValue(null);
    await reconcileActiveSources(ctx(true));
    expect(syncLifecycle).toHaveBeenLastCalledWith(['hae'], expect.anything());
    await reconcileActiveSources(ctx(true));
    expect(syncLifecycle).toHaveBeenCalledTimes(1);
    await reconcileActiveSources(ctx(false));
    expect(syncLifecycle).toHaveBeenCalledTimes(2);
    expect(syncLifecycle).toHaveBeenLastCalledWith([], expect.anything());
  });

  it('retries a lifecycle record that failed, even though the set has not changed again', async () => {
    syncLifecycle.mockRejectedValueOnce(new Error('connection refused'));
    const first = await reconcileActiveSources(ctx(true));
    expect(first.active).toEqual(['hae']); // a store failure never breaks the caller
    syncLifecycle.mockResolvedValue(null);
    await reconcileActiveSources(ctx(true));
    expect(syncLifecycle).toHaveBeenCalledTimes(2);
    await reconcileActiveSources(ctx(true));
    expect(syncLifecycle).toHaveBeenCalledTimes(2); // stored: no further calls
  });
});
