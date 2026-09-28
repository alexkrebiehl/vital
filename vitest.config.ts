import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The briefing cache is anchored on globalThis so that the page bundle and
    // the route bundle share ONE cache in the server (they are separate module
    // graphs). That makes it process-wide state, so test FILES must not share a
    // process: two files filling briefings concurrently would see each other's
    // entries and fail intermittently. One process per file restores the
    // isolation the suite was written under.
    pool: 'forks',
    isolate: true,
    // A test that exercises the provider's rate-limit path sleeps through the
    // deliberate backoff (RATE_LIMIT_RETRIES x RATE_LIMIT_BACKOFF_MS = 3.6 s)
    // before it can assert. The 5 s default left ~1.4 s of margin, so the test
    // passed on an idle machine and timed out under load — a flake that made a
    // green suite read as red and cost a real investigation to attribute. The
    // budget is raised here rather than in one test so any future test that
    // waits on bounded retries is not silently racing the clock.
    testTimeout: 20000,
  },
  // Components are written for the automatic JSX runtime (as Next compiles
  // them), so a component import in a test must be transformed the same way —
  // otherwise JSX would compile to React.createElement and fail with
  // "React is not defined" because no component imports React.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});