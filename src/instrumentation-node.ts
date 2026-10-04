// ── Boot-time live dataset warm-up (Node runtime only) ──
//
// Loaded by `register()` in `instrumentation.ts` only on the Node runtime; see
// that file for what the warm-up is and is not. Every declared profile is
// warmed, each inside its own scope, so each person's history is cut in their
// own profile's zone and cached under their own key.

export async function warmUp(): Promise<void> {
  const { warmLiveDataset } = await import('@/lib/adapters/live');
  const { readProfile } = await import('@/lib/profile/store');
  const { allIdentities } = await import('@/lib/identity');
  const { runAsUser } = await import('@/lib/identity/scope');

  for (const identity of await allIdentities()) {
    const label = identity.primary && identity.slug === 'owner' ? '' : ` for ${identity.slug}`;
    await runAsUser(identity, async () => {
      const started = Date.now();
      // Warm the entry requests will hit: the dataset is cut in the profile's zone.
      const { timezone } = await readProfile();
      const warm = warmLiveDataset({ timezone });
      if (!warm) return; // demo mode, or the export API is not configured

      console.log(`[vital] live dataset cache warm-up${label} started (read-only cache fill).`);
      void warm.then(outcome => {
        const elapsed = Date.now() - started;
        console.log(
          outcome.ok
            ? `[vital] live dataset cache warm-up${label} finished in ${elapsed} ms; the next request is served from cache.`
            : `[vital] live dataset cache warm-up${label} failed after ${elapsed} ms: ${outcome.reason} ` +
              'The next request will retry and report the failure.'
        );
      });
    });
  }
}
